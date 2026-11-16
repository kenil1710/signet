// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// TapeOut functions used by the core contracts. Every one is recorded in docs/tapeout-interfaces.md
// (TAP-02 §6, TAP-10 Appendix A, and X Layer bytecode/measurements). Do not add functions that are not there.

/// Processor contract: stores and evaluates circuits (TAP-02 §6).
interface IPolicyProcessor {
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

/// The circuit beacon behind every processor proxy (owner renounced on X Layer, docs §6).
interface ICircuitBeacon {
    function implementation() external view returns (address);
}

/// SiteRegistry (TAP-10 Appendix A).
interface ISiteRegistryWriter {
    function putFile(address container, string calldata path, string calldata contentType, bytes32 sha256Hash, bytes calldata data)
        external;
    function fileInfo(address container, string calldata path)
        external
        view
        returns (uint32 size, string memory contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount);
}

/// Container opener (TAP-10 Appendix A + bytecode).
interface IContainerOpener {
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
}

/// Processor ERC-721 owner lookup.
interface ICircuitNFT {
    function ownerOf(uint256 id) external view returns (address);
}
