// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function isRegistered(address agent) external view returns (bool);
    function stakes(address agent) external view returns (uint256);
    function hasCapabilities(address agent, bytes32[] calldata caps) external view returns (bool);
}
