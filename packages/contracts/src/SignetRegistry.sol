// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISiteRegistryWriter, IContainerOpener, ICircuitNFT} from "./interfaces/ITapeOutPolicy.sol";

interface IReleaseGateView {
    function currentManifestHash() external view returns (bytes32);
}

/// Domain -> project binding, and the writer for Signet's shared container (docs/decisions.md, 2026-11-16).
///
/// Bindings: the first claim of a domain is open (spec threat 11: DNS TXT proof at first claim, checked off-chain
/// by Guard and the watchtower). After that, only the bound ReleaseGate can change the binding, and a gate does
/// that only by executing a tier-11 proposal (3 of 3 + 24 h).
///
/// Shared container: this contract holds the circuit NFT of Signet's shared container. For a free-tier domain it
/// writes `projects/<domain>/manifest.json`, and only bytes whose SHA-256 equals the bound gate's current
/// (published) manifest hash. Anyone may relay the bytes; the content is fixed by the gate's approval.
/// There is no owner, no upgrade path, and no way to move the NFT out or write outside `projects/<domain>/`.
contract SignetRegistry {
    struct Binding {
        address gate;
        address container; // 0 = Signet's shared container
    }

    ISiteRegistryWriter public immutable siteRegistry;
    ICircuitNFT public immutable sharedCircuits; // processor of the shared container's circuit
    uint256 public immutable sharedCircuitId;
    address public immutable sharedContainer;

    uint256 public constant MAX_MANIFEST_BYTES = 24_000; // one SiteRegistry chunk (CHUNK_MAX)

    mapping(bytes32 => Binding) internal bindings; // keccak256(domain)

    event Claimed(string domain, address indexed gate, address container);
    event ContainerSet(string domain, address indexed gate, address container);
    event Transferred(string domain, address indexed fromGate, address indexed toGate);
    event Unbound(string domain, address indexed gate);
    event ManifestWritten(string domain, address indexed gate, bytes32 sha256Hash, uint256 size);

    error BadDomain();
    error AlreadyBound();
    error NotBoundGate();
    error NotShared();
    error NotApproved();
    error TooLarge();
    error WrongNFT();
    error NotHolder();

    constructor(ISiteRegistryWriter siteRegistry_, IContainerOpener opener, ICircuitNFT circuits, uint256 circuitId) {
        siteRegistry = siteRegistry_;
        sharedCircuits = circuits;
        sharedCircuitId = circuitId;
        sharedContainer = opener.accountOf(address(circuits), circuitId);
    }

    // ---------------------------------------------------------------- bindings

    function claim(string calldata domain, address container) external {
        _checkDomain(domain);
        Binding storage b = bindings[keccak256(bytes(domain))];
        if (b.gate != address(0)) revert AlreadyBound();
        b.gate = msg.sender;
        b.container = container;
        emit Claimed(domain, msg.sender, container);
    }

    function setContainer(string calldata domain, address container) external {
        Binding storage b = _own(domain);
        b.container = container;
        emit ContainerSet(domain, msg.sender, container);
    }

    function transfer(string calldata domain, address newGate) external {
        Binding storage b = _own(domain);
        if (newGate == address(0)) revert BadDomain();
        b.gate = newGate;
        emit Transferred(domain, msg.sender, newGate);
    }

    function unbind(string calldata domain) external {
        _own(domain);
        delete bindings[keccak256(bytes(domain))];
        emit Unbound(domain, msg.sender);
    }

    function bindingOf(string calldata domain) external view returns (address gate, address container) {
        Binding storage b = bindings[keccak256(bytes(domain))];
        return (b.gate, b.gate == address(0) ? address(0) : b.container == address(0) ? sharedContainer : b.container);
    }

    // ---------------------------------------------------------------- shared container writer

    /// Writes `projects/<domain>/manifest.json` in the shared container. Anyone may call; `data` must hash to the
    /// manifest the domain's gate has published.
    function writeManifest(string calldata domain, bytes calldata data) external {
        Binding storage b = bindings[keccak256(bytes(domain))];
        if (b.gate == address(0)) revert NotBoundGate();
        if (b.container != address(0)) revert NotShared();
        if (data.length == 0 || data.length > MAX_MANIFEST_BYTES) revert TooLarge();
        bytes32 h = sha256(data);
        if (h != IReleaseGateView(b.gate).currentManifestHash()) revert NotApproved();
        if (sharedCircuits.ownerOf(sharedCircuitId) != address(this)) revert NotHolder();
        siteRegistry.putFile(sharedContainer, manifestPath(domain), "application/json", h, data);
        emit ManifestWritten(domain, b.gate, h, data.length);
    }

    function manifestPath(string calldata domain) public pure returns (string memory) {
        return string.concat("projects/", domain, "/manifest.json");
    }

    /// Accept only the shared container's circuit NFT. It can never leave this contract.
    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(sharedCircuits) || tokenId != sharedCircuitId) revert WrongNFT();
        return this.onERC721Received.selector;
    }

    // ---------------------------------------------------------------- internals

    function _own(string calldata domain) internal view returns (Binding storage b) {
        b = bindings[keccak256(bytes(domain))];
        if (b.gate == address(0) || b.gate != msg.sender) revert NotBoundGate();
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
