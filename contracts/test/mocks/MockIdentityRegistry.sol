// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockIdentityRegistry — test stub for ERC-8004 Identity Registry
contract MockIdentityRegistry {
    uint256 private _nextId = 1;
    mapping(uint256 => string) public agentURIs;

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextId++;
        agentURIs[agentId] = agentURI;
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        agentURIs[agentId] = newURI;
    }

    function setMetadata(uint256, string memory, bytes memory) external {}
    function getMetadata(uint256, string memory) external pure returns (bytes memory) { return ""; }
}
