// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISiteRegistryWriter, IContainerOpener, ICircuitNFT} from "./interfaces/ITapeOutPolicy.sol";

interface IReleaseGateView {
    function activeRelease() external view returns (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok);
}

/// Domain -> project binding, and the file writer for sealed releases (docs/decisions.md).
///
/// Bindings. Only gates made by SignetFactory can be bound, and a first claim goes through the factory's
/// commit-reveal. After that only the bound gate can change the binding, and a gate does that only by executing
/// a tier-11 proposal. A transfer needs the receiving gate to accept. After an unbind, only the previous gate
/// can claim the domain again for 30 days.
///
/// Files. This contract never holds a circuit NFT. It writes as the SiteRegistry OPERATOR of a container, a
/// right the container's holder grants for at most 30 days at a time:
///   - Signet's shared container:  `projects/<domain>/` for every free-tier project, and `signet/<domain>/` for
///     Signet's own site (one gate, fixed at deployment, one domain). The two prefixes can never overlap.
///   - own container: a container whose circuit NFT the bound gate itself holds, at the container root
/// It writes only bytes the bound gate's current, non-revoked release approves:
///   signet/allowlist.json   sha256(bytes) == allowlistHash
///   signet/origins.json     sha256(bytes) == originsHash
///   any other path          sha256-Merkle proof of leaf(domain, path, contentType, sha256(bytes)) against filesRoot
/// Anyone may relay the bytes; the content is fixed by the gate's approval.
///
/// There is no owner, no upgrade and no migration switch: this registry never locks. A future v2 registry
/// would import these bindings read-only.
contract SignetRegistry {
    struct Binding {
        address gate;
        address circuits; // 0 = Signet's shared container; else the processor of the gate's own container
        uint256 tokenId;
        address pendingGate; // a started transfer waiting for this gate to accept
        uint40 pendingAt; // when the transfer was started; it expires after TRANSFER_WINDOW
    }

    struct Unbound {
        address gate;
        uint40 at;
    }

    ISiteRegistryWriter public immutable siteRegistry;
    IContainerOpener public immutable opener;
    address public immutable sharedCircuits;
    uint256 public immutable sharedCircuitId;
    address public immutable sharedContainer;
    /// The only factory whose gates may be bound. Fixed at deployment (the deployer predicts its address).
    address public immutable factory;
    /// The gate of Signet's own site. Fixed at deployment, before any gate or binding exists (a predicted
    /// address). It matters only once the factory really creates a gate there.
    address public immutable signetSiteGate;

    uint256 public constant CHUNK = 24_000; // SiteRegistry CHUNK_MAX
    /// 2 chunks. One write of this size used 10.5M gas on a fork, under a 2^24 (16.7M) per-transaction cap.
    /// X Layer shows no such cap today (2026-11-17, docs/tapeout-interfaces.md), but OP-stack chains are adopting it.
    uint256 public constant MAX_FILE_BYTES = 48_000;
    uint256 public constant RECLAIM_WINDOW = 30 days;
    uint256 public constant TRANSFER_WINDOW = 7 days;
    string public constant ALLOWLIST_PATH = "signet/allowlist.json";
    string public constant ORIGINS_PATH = "signet/origins.json";

    bytes32 public signetSiteDomain; // keccak256 of the ONE shared-container domain of Signet's site gate (0 = none)
    mapping(address => bool) public isGate;
    mapping(bytes32 => Binding) internal bindings; // keccak256(domain)
    mapping(bytes32 => Unbound) public lastUnbound;

    event Claimed(string domain, address indexed gate, address circuits, uint256 tokenId);
    event ContainerSet(string domain, address indexed gate, address circuits, uint256 tokenId);
    event TransferStarted(string domain, address indexed fromGate, address indexed toGate);
    event TransferCancelled(string domain, address indexed gate);
    event Transferred(string domain, address indexed fromGate, address indexed toGate);
    event Unbound_(string domain, address indexed gate);
    event FileWritten(string domain, address indexed gate, string path, bytes32 sha256Hash, uint256 size);
    event FileRemoved(string domain, address indexed gate, string path);

    error BadDomain();
    error BadPath();
    error AlreadyBound();
    error Reserved();
    error NotBoundGate();
    error NotFactoryGate();
    error NotApproved();
    error BadSize();
    error NotHolder();
    error SharedHasNoFallback();
    error BadConfig();
    error TransferExpired();
    error SiteGateHasADomain();

    constructor(
        ISiteRegistryWriter siteRegistry_,
        IContainerOpener opener_,
        address circuits,
        uint256 circuitId,
        address factory_,
        address signetSiteGate_
    ) {
        if (factory_ == address(0) || factory_.code.length != 0 || signetSiteGate_.code.length != 0) revert BadConfig();
        siteRegistry = siteRegistry_;
        opener = opener_;
        sharedCircuits = circuits;
        sharedCircuitId = circuitId;
        sharedContainer = opener_.accountOf(circuits, circuitId);
        factory = factory_; // not deployed yet: nothing can be registered or bound before this registry exists
        signetSiteGate = signetSiteGate_;
    }

    // ---------------------------------------------------------------- bindings

    /// Factory only: mark a freshly deployed gate as genuine.
    function register(address gate) external {
        if (msg.sender != factory) revert NotFactoryGate();
        isGate[gate] = true;
    }

    /// Factory only, after it checked the claimant's commit: bind a new domain to a factory-made gate.
    function claimFor(address gate, string calldata domain, address circuits, uint256 tokenId) external {
        if (msg.sender != factory || !isGate[gate]) revert NotFactoryGate();
        _checkDomain(domain);
        bytes32 key = keccak256(bytes(domain));
        Binding storage b = bindings[key];
        if (b.gate != address(0)) revert AlreadyBound();
        Unbound storage u = lastUnbound[key];
        if (u.gate != address(0) && u.gate != gate && block.timestamp < uint256(u.at) + RECLAIM_WINDOW) revert Reserved();
        b.gate = gate;
        b.circuits = circuits;
        b.tokenId = tokenId;
        _siteRule(gate, key, circuits);
        emit Claimed(domain, gate, circuits, tokenId);
    }

    function setContainer(string calldata domain, address circuits, uint256 tokenId) external {
        Binding storage b = _own(domain);
        bytes32 key = keccak256(bytes(domain));
        if (signetSiteDomain == key && circuits != address(0)) signetSiteDomain = 0; // leaves the shared container
        b.circuits = circuits;
        b.tokenId = tokenId;
        _siteRule(msg.sender, key, circuits);
        emit ContainerSet(domain, msg.sender, circuits, tokenId);
    }

    /// Signet's site gate can have exactly one domain in the shared container.
    function _siteRule(address gate, bytes32 key, address circuits) internal {
        if (gate != signetSiteGate || circuits != address(0) || signetSiteDomain == key) return;
        if (signetSiteDomain != 0) revert SiteGateHasADomain();
        signetSiteDomain = key;
    }

    /// Step 1 of a transfer (the bound gate, tier 11). Nothing changes until the new gate accepts,
    /// and the offer expires after 7 days.
    function transfer(string calldata domain, address newGate) external {
        Binding storage b = _own(domain);
        if (!isGate[newGate]) revert NotFactoryGate();
        b.pendingGate = newGate;
        b.pendingAt = uint40(block.timestamp);
        emit TransferStarted(domain, msg.sender, newGate);
    }

    /// The bound gate withdraws a pending transfer (tier 11).
    function cancelTransfer(string calldata domain) external {
        Binding storage b = _own(domain);
        b.pendingGate = address(0);
        b.pendingAt = 0;
        emit TransferCancelled(domain, msg.sender);
    }

    /// Step 2: the receiving gate accepts (tier 11 on its side). The domain moves to the shared container.
    function acceptTransfer(string calldata domain) external {
        Binding storage b = _bound(domain);
        if (b.pendingGate != msg.sender) revert NotBoundGate();
        if (block.timestamp > uint256(b.pendingAt) + TRANSFER_WINDOW) revert TransferExpired();
        bytes32 key = keccak256(bytes(domain));
        if (signetSiteDomain == key) signetSiteDomain = 0; // it leaves Signet's site gate
        emit Transferred(domain, b.gate, msg.sender);
        b.gate = msg.sender;
        b.pendingGate = address(0);
        b.pendingAt = 0;
        b.circuits = address(0);
        b.tokenId = 0;
        _siteRule(msg.sender, key, address(0));
    }

    function unbind(string calldata domain) external {
        _own(domain);
        bytes32 key = keccak256(bytes(domain));
        if (signetSiteDomain == key) signetSiteDomain = 0;
        delete bindings[key];
        lastUnbound[key] = Unbound(msg.sender, uint40(block.timestamp));
        emit Unbound_(domain, msg.sender);
    }

    /// Where a domain's sealed files are. Returns all-empty when the domain is unbound, and also when it names
    /// an own container that isn't valid for its gate (the gate doesn't hold that circuit NFT, or it is the
    /// shared container): readers must then treat the domain as not protected.
    function bindingOf(string calldata domain) external view returns (address gate, address container, string memory prefix) {
        Binding storage b = bindings[keccak256(bytes(domain))];
        if (b.gate == address(0)) return (address(0), address(0), "");
        if (b.circuits == address(0)) return (b.gate, sharedContainer, _sharedPrefix(b.gate, domain));
        container = opener.accountOf(b.circuits, b.tokenId);
        if (container == sharedContainer) return (address(0), address(0), "");
        try ICircuitNFT(b.circuits).ownerOf(b.tokenId) returns (address holder) {
            if (holder != b.gate) return (address(0), address(0), "");
        } catch {
            return (address(0), address(0), "");
        }
        return (b.gate, container, "");
    }

    /// The gate a domain is bound to, whether or not its container is currently valid.
    function gateOf(string calldata domain) external view returns (address) {
        return bindings[keccak256(bytes(domain))].gate;
    }

    function pendingGateOf(string calldata domain) external view returns (address) {
        Binding storage b = bindings[keccak256(bytes(domain))];
        return block.timestamp > uint256(b.pendingAt) + TRANSFER_WINDOW ? address(0) : b.pendingGate;
    }

    // ---------------------------------------------------------------- files

    struct File {
        string domain;
        string path;
        string contentType;
        bytes data;
        bytes32[] proof; // Merkle proof against filesRoot (empty for the allowlist and origins files)
    }

    /// Writes one file of the domain's current release. Anyone may call. The whole file comes in one transaction,
    /// is checked against the approved hashes here, and is stored in 24,000-byte chunks.
    function writeFile(File calldata f) external {
        if (f.data.length == 0 || f.data.length > MAX_FILE_BYTES) revert BadSize();
        _checkPath(f.path);
        Binding storage b = _bound(f.domain);
        bytes32 h = sha256(f.data);
        // the domain is part of the leaf: a file sealed for one domain of a gate can't be written for another
        _checkApproved(b.gate, keccak256(bytes(f.path)), h, sha256(abi.encode(f.domain, f.path, f.contentType, h)), f.proof);
        (address container, string memory full) = _target(b, f.domain, f.path);
        _store(container, full, f.contentType, h, f.data);
        emit FileWritten(f.domain, b.gate, f.path, h, f.data.length);
    }

    function _checkApproved(address gate, bytes32 pathHash, bytes32 h, bytes32 node, bytes32[] calldata proof) internal view {
        (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok) = IReleaseGateView(gate).activeRelease();
        if (!ok) revert NotApproved();
        if (pathHash == keccak256(bytes(ALLOWLIST_PATH))) {
            if (h != allowlistHash) revert NotApproved();
        } else if (pathHash == keccak256(bytes(ORIGINS_PATH))) {
            if (h != originsHash) revert NotApproved();
        } else {
            for (uint256 i; i < proof.length; i++) {
                bytes32 p = proof[i];
                node = node < p ? sha256(abi.encodePacked(node, p)) : sha256(abi.encodePacked(p, node));
            }
            if (node != filesRoot) revert NotApproved();
        }
    }

    function _store(address container, string memory full, string calldata contentType, bytes32 h, bytes calldata data)
        internal
    {
        uint256 first = data.length < CHUNK ? data.length : CHUNK;
        siteRegistry.putFile(container, full, contentType, h, data[:first]);
        uint256 index = 1;
        for (uint256 off = first; off < data.length; off += CHUNK) {
            uint256 end = off + CHUNK < data.length ? off + CHUNK : data.length;
            siteRegistry.appendChunk(container, full, index++, data[off:end]);
        }
    }

    /// Bound gate only: remove a file of this domain (tier 11, or 2 approvals while the release is revoked).
    function removeFile(string calldata domain, string calldata path) external {
        Binding storage b = _own(domain);
        (address container, string memory full) = _target(b, domain, path);
        siteRegistry.removeFile(container, full);
        emit FileRemoved(domain, msg.sender, path);
    }

    /// Bound gate only (tier 11). SiteRegistry has ONE fallback path per container, so nothing inside the
    /// shared container (projects or Signet's own site) can have one; only a gate's own container can.
    function setFallback(string calldata domain, string calldata path) external {
        Binding storage b = _own(domain);
        if (b.circuits == address(0)) revert SharedHasNoFallback();
        (address container, string memory full) = _target(b, domain, path);
        siteRegistry.setFallback(container, full);
    }

    // ---------------------------------------------------------------- internals

    function _bound(string calldata domain) internal view returns (Binding storage b) {
        b = bindings[keccak256(bytes(domain))];
        if (b.gate == address(0)) revert NotBoundGate();
    }

    function _own(string calldata domain) internal view returns (Binding storage b) {
        b = _bound(domain);
        if (b.gate != msg.sender) revert NotBoundGate();
    }

    function _sharedPrefix(address gate, string calldata domain) internal view returns (string memory) {
        return string.concat(gate == signetSiteGate ? "signet/" : "projects/", domain, "/");
    }

    /// Where a domain's file goes. Shared container: `signet/<domain>/<path>` for Signet's own site, otherwise
    /// `projects/<domain>/<path>`. Own container: `<path>`, only while the bound gate itself holds that
    /// container's circuit NFT, and never the shared container.
    function _target(Binding storage b, string calldata domain, string calldata path)
        internal
        view
        returns (address container, string memory full)
    {
        _checkPath(path);
        if (b.circuits == address(0)) return (sharedContainer, string.concat(_sharedPrefix(b.gate, domain), path));
        container = opener.accountOf(b.circuits, b.tokenId);
        if (container == sharedContainer || ICircuitNFT(b.circuits).ownerOf(b.tokenId) != b.gate) revert NotHolder();
        return (container, path);
    }

    /// Relative path of printable ASCII, 1..200 bytes, no empty, "." or ".." segments.
    function _checkPath(string calldata path) internal pure {
        bytes calldata p = bytes(path);
        if (p.length == 0 || p.length > 200) revert BadPath();
        uint256 segStart;
        for (uint256 i; i <= p.length; i++) {
            if (i == p.length || p[i] == "/") {
                uint256 len = i - segStart;
                if (len == 0) revert BadPath();
                if (p[segStart] == "." && (len == 1 || (len == 2 && p[segStart + 1] == "."))) revert BadPath();
                segStart = i + 1;
            } else if (p[i] < 0x21 || p[i] > 0x7e || p[i] == "\\") {
                revert BadPath();
            }
        }
    }

    /// Lowercase hostname: labels of [a-z0-9-], 1..63 chars, no leading/trailing '-', at least one dot,
    /// total 3..253. This also rules out '/', '..', and anything that could escape `projects/<domain>/`.
    function _checkDomain(string calldata domain) internal pure {
        bytes calldata d = bytes(domain);
        if (d.length < 3 || d.length > 253) revert BadDomain();
        uint256 labelLen;
        uint256 dots;
        for (uint256 i; i < d.length; i++) {
            bytes1 c = d[i];
            if (c == ".") {
                if (labelLen == 0 || d[i - 1] == "-") revert BadDomain();
                labelLen = 0;
                dots++;
                continue;
            }
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) revert BadDomain();
            if (labelLen == 0 && c == "-") revert BadDomain();
            labelLen++;
            if (labelLen > 63) revert BadDomain();
        }
        if (labelLen == 0 || d[d.length - 1] == "-" || dots == 0) revert BadDomain();
    }
}
