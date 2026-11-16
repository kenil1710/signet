// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISiteRegistryWriter, IContainerOpener, ICircuitNFT} from "./interfaces/ITapeOutPolicy.sol";

interface IReleaseGateView {
    function activeRelease() external view returns (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok);
}

/// Domain -> project binding, and the file writer for sealed releases (docs/decisions.md).
///
/// Bindings. Only gates made by SignetFactory can be bound. The first claim of a domain is open (spec threat 11:
/// DNS TXT proof at first claim, checked off-chain). After that only the bound gate can change the binding, and a
/// gate does that only by executing a tier-11 proposal.
///
/// Files. This contract never holds a circuit NFT. It writes as the SiteRegistry OPERATOR of a container, a
/// right the container's holder grants for at most 30 days at a time:
///   - free tier:  Signet's shared container, under `projects/<domain>/`
///   - own container: a container whose circuit NFT the bound gate itself holds, at the container root
/// It writes only bytes the bound gate's current, non-revoked release approves:
///   signet/allowlist.json   sha256(bytes) == allowlistHash
///   signet/origins.json     sha256(bytes) == originsHash
///   any other path          sha256-Merkle proof of leaf(path, contentType, sha256(bytes)) against filesRoot
/// Anyone may relay the bytes; the content is fixed by the gate's approval.
///
/// Migration. Signet ops (2 of 3) can announce a successor registry; it takes effect 7 days after a public
/// event. From then on this registry stops accepting claims and writes. Gates follow by their own tier-11 vote.
contract SignetRegistry {
    struct Binding {
        address gate;
        address circuits; // 0 = Signet's shared container; else the processor of the gate's own container
        uint256 tokenId;
    }

    ISiteRegistryWriter public immutable siteRegistry;
    IContainerOpener public immutable opener;
    address public immutable sharedCircuits;
    uint256 public immutable sharedCircuitId;
    address public immutable sharedContainer;
    address public immutable deployer;

    uint256 public constant CHUNK = 24_000; // SiteRegistry CHUNK_MAX
    uint256 public constant MAX_FILE_BYTES = 96_000; // 4 chunks, written and hash-checked in one transaction
    uint256 public constant MIGRATION_DELAY = 7 days;
    string public constant ALLOWLIST_PATH = "signet/allowlist.json";
    string public constant ORIGINS_PATH = "signet/origins.json";

    address public factory;
    mapping(address => bool) public isGate;
    mapping(bytes32 => Binding) internal bindings; // keccak256(domain)

    address[3] public ops;
    address public pendingSuccessor;
    address public pendingBy;
    uint40 public migrationAt; // 0 = not scheduled
    address public successor; // set once the migration executed

    event Claimed(string domain, address indexed gate, address circuits, uint256 tokenId);
    event ContainerSet(string domain, address indexed gate, address circuits, uint256 tokenId);
    event Transferred(string domain, address indexed fromGate, address indexed toGate);
    event Unbound(string domain, address indexed gate);
    event FileWritten(string domain, address indexed gate, string path, bytes32 sha256Hash, uint256 size);
    event FileRemoved(string domain, address indexed gate, string path);
    event MigrationProposed(address indexed successor, address indexed by);
    event MigrationScheduled(address indexed successor, uint256 executeAfter);
    event MigrationCancelled(address indexed by);
    event Migrated(address indexed successor);

    error BadDomain();
    error BadPath();
    error AlreadyBound();
    error NotBoundGate();
    error NotFactoryGate();
    error NotApproved();
    error BadSize();
    error NotHolder();
    error SharedHasNoFallback();
    error NotOps();
    error MigrationClosed();
    error TooEarly();
    error BadConfig();

    constructor(ISiteRegistryWriter siteRegistry_, IContainerOpener opener_, address circuits, uint256 circuitId, address[3] memory ops_) {
        if (ops_[0] == address(0) || ops_[1] == address(0) || ops_[2] == address(0)) revert BadConfig();
        if (ops_[0] == ops_[1] || ops_[0] == ops_[2] || ops_[1] == ops_[2]) revert BadConfig();
        siteRegistry = siteRegistry_;
        opener = opener_;
        sharedCircuits = circuits;
        sharedCircuitId = circuitId;
        sharedContainer = opener_.accountOf(circuits, circuitId);
        ops = ops_;
        deployer = msg.sender;
    }

    /// One time, by the deployer: the only factory whose gates may be bound.
    function initFactory(address factory_) external {
        if (msg.sender != deployer || factory != address(0) || factory_ == address(0)) revert BadConfig();
        factory = factory_;
    }

    // ---------------------------------------------------------------- bindings

    /// Factory only: mark a freshly deployed gate as genuine.
    function register(address gate) external {
        if (msg.sender != factory) revert NotFactoryGate();
        isGate[gate] = true;
    }

    /// Factory only: first claim for a gate it just deployed (same transaction as the deployment).
    function claimFor(address gate, string calldata domain, address circuits, uint256 tokenId) external {
        if (msg.sender != factory) revert NotFactoryGate();
        _claim(gate, domain, circuits, tokenId);
    }

    /// A factory-made gate claims another domain (tier-11 on the gate's side).
    function claim(string calldata domain, address circuits, uint256 tokenId) external {
        if (!isGate[msg.sender]) revert NotFactoryGate();
        _claim(msg.sender, domain, circuits, tokenId);
    }

    function setContainer(string calldata domain, address circuits, uint256 tokenId) external {
        Binding storage b = _own(domain);
        b.circuits = circuits;
        b.tokenId = tokenId;
        emit ContainerSet(domain, msg.sender, circuits, tokenId);
    }

    function transfer(string calldata domain, address newGate) external {
        Binding storage b = _own(domain);
        if (!isGate[newGate]) revert NotFactoryGate();
        b.gate = newGate;
        emit Transferred(domain, msg.sender, newGate);
    }

    function unbind(string calldata domain) external {
        _own(domain);
        delete bindings[keccak256(bytes(domain))];
        emit Unbound(domain, msg.sender);
    }

    function bindingOf(string calldata domain) external view returns (address gate, address container, string memory prefix) {
        Binding storage b = bindings[keccak256(bytes(domain))];
        if (b.gate == address(0)) return (address(0), address(0), "");
        if (b.circuits == address(0)) return (b.gate, sharedContainer, string.concat("projects/", domain, "/"));
        return (b.gate, opener.accountOf(b.circuits, b.tokenId), "");
    }

    // ---------------------------------------------------------------- files

    /// Writes one file of the domain's current release. Anyone may call. The whole file comes in one transaction,
    /// is checked against the approved hashes here, and is stored in 24,000-byte chunks.
    function writeFile(
        string calldata domain,
        string calldata path,
        string calldata contentType,
        bytes calldata data,
        bytes32[] calldata proof
    ) external {
        if (data.length == 0 || data.length > MAX_FILE_BYTES) revert BadSize();
        _checkPath(path);
        Binding storage b = _bound(domain);
        bytes32 h = _checkApproved(b.gate, path, contentType, data, proof);
        (address container, string memory full) = _target(b, domain, path);
        _store(container, full, contentType, h, data);
        emit FileWritten(domain, b.gate, path, h, data.length);
    }

    function _checkApproved(
        address gate,
        string calldata path,
        string calldata contentType,
        bytes calldata data,
        bytes32[] calldata proof
    ) internal view returns (bytes32 h) {
        (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok) = IReleaseGateView(gate).activeRelease();
        if (!ok) revert NotApproved();
        h = sha256(data);
        bytes32 pathHash = keccak256(bytes(path));
        if (pathHash == keccak256(bytes(ALLOWLIST_PATH))) {
            if (h != allowlistHash) revert NotApproved();
        } else if (pathHash == keccak256(bytes(ORIGINS_PATH))) {
            if (h != originsHash) revert NotApproved();
        } else {
            bytes32 node = sha256(abi.encode(path, contentType, h));
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

    /// Bound gate only (tier 11 on the gate's side): remove a file of this domain.
    function removeFile(string calldata domain, string calldata path) external {
        Binding storage b = _own(domain);
        (address container, string memory full) = _target(b, domain, path);
        siteRegistry.removeFile(container, full);
        emit FileRemoved(domain, msg.sender, path);
    }

    /// Bound gate only (tier 11). SiteRegistry has ONE fallback path per container, so a project inside the
    /// shared container can't have its own; only a gate's own container can.
    function setFallback(string calldata domain, string calldata path) external {
        Binding storage b = _own(domain);
        if (b.circuits == address(0)) revert SharedHasNoFallback();
        (address container, string memory full) = _target(b, domain, path);
        siteRegistry.setFallback(container, full);
    }

    // ---------------------------------------------------------------- migration (Signet ops, 2 of 3)

    /// Two different ops proposing the same successor schedule the migration, 7 days ahead.
    function proposeMigration(address next) external {
        _onlyOps();
        if (successor != address(0) || next == address(0) || next == address(this)) revert MigrationClosed();
        if (pendingSuccessor == next && pendingBy != msg.sender && migrationAt == 0) {
            migrationAt = uint40(block.timestamp + MIGRATION_DELAY);
            emit MigrationScheduled(next, migrationAt);
        } else {
            pendingSuccessor = next;
            pendingBy = msg.sender;
            migrationAt = 0;
            emit MigrationProposed(next, msg.sender);
        }
    }

    /// Any one op can cancel a proposed or scheduled migration.
    function cancelMigration() external {
        _onlyOps();
        if (successor != address(0)) revert MigrationClosed();
        delete pendingSuccessor;
        delete pendingBy;
        migrationAt = 0;
        emit MigrationCancelled(msg.sender);
    }

    function executeMigration() external {
        if (migrationAt == 0 || successor != address(0)) revert MigrationClosed();
        if (block.timestamp < migrationAt) revert TooEarly();
        successor = pendingSuccessor;
        emit Migrated(successor);
    }

    // ---------------------------------------------------------------- internals

    function _claim(address gate, string calldata domain, address circuits, uint256 tokenId) internal {
        if (successor != address(0)) revert MigrationClosed();
        _checkDomain(domain);
        Binding storage b = bindings[keccak256(bytes(domain))];
        if (b.gate != address(0)) revert AlreadyBound();
        b.gate = gate;
        b.circuits = circuits;
        b.tokenId = tokenId;
        emit Claimed(domain, gate, circuits, tokenId);
    }

    function _bound(string calldata domain) internal view returns (Binding storage b) {
        if (successor != address(0)) revert MigrationClosed();
        b = bindings[keccak256(bytes(domain))];
        if (b.gate == address(0)) revert NotBoundGate();
    }

    function _own(string calldata domain) internal view returns (Binding storage b) {
        b = _bound(domain);
        if (b.gate != msg.sender) revert NotBoundGate();
    }

    /// Where a domain's file goes. Shared: `projects/<domain>/<path>`. Own container: `<path>`, and only while the
    /// bound gate itself holds that container's circuit NFT. If the own container is the shared one (Signet's own
    /// site), `projects/` stays off limits.
    function _target(Binding storage b, string calldata domain, string calldata path)
        internal
        view
        returns (address container, string memory full)
    {
        _checkPath(path);
        if (b.circuits == address(0)) return (sharedContainer, string.concat("projects/", domain, "/", path));
        if (ICircuitNFT(b.circuits).ownerOf(b.tokenId) != b.gate) revert NotHolder();
        container = opener.accountOf(b.circuits, b.tokenId);
        bytes calldata p = bytes(path);
        if (container == sharedContainer && p.length >= 9 && bytes9(p[:9]) == "projects/") revert BadPath();
        return (container, path);
    }

    function _onlyOps() internal view {
        if (msg.sender != ops[0] && msg.sender != ops[1] && msg.sender != ops[2]) revert NotOps();
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
