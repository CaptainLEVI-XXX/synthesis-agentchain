// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {DelegationHop} from "./ICommon.sol";

interface IDelegationTracker {
    function recordDelegation(bytes32 taskId, address from, address to, uint8 depth, bytes32 delegationHash, uint256 fee) external;
    function getTaskDelegations(bytes32 taskId) external view returns (DelegationHop[] memory);
    function getPromisedFee(bytes32 taskId, address agent) external view returns (uint256);
    function getTotalPromisedFees(bytes32 taskId) external view returns (uint256);
    function hasWorkRecord(bytes32 taskId, address agent) external view returns (bool);
    function settleTask(bytes32 taskId) external;
    function tasks(bytes32) external view returns (
        address creator,
        address orchestrator,
        uint8 status,
        uint256 deadline,
        uint256 delegationCount,
        uint256 deposit,
        bool hasEscrow,
        string memory intent
    );
}
