// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAgentRegistry {
    function isRegistered(address agent) external view returns (bool);
    function stakes(address agent) external view returns (uint256);
    function hasCapabilities(address agent, bytes32[] calldata caps) external view returns (bool);
    function agents(address) external view returns (
        string memory name,
        string memory endpoint,
        uint256 erc8004Id,
        string memory ensName,
        uint256 registeredAt,
        bool active
    );
    function distributeFeesFromStake(
        address orchestrator,
        address[] calldata agents_,
        uint256[] calldata fees
    ) external;
}
