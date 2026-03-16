// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDelegationTracker {
    function recordDelegation(bytes32 taskId, address from, address to, uint8 depth, bytes32 delegationHash, uint256 fee) external;
    function getPromisedFee(bytes32 taskId, address agent) external view returns (uint256);
    function getTotalPromisedFees(bytes32 taskId) external view returns (uint256);
    function hasWorkRecord(bytes32 taskId, address agent) external view returns (bool);
    function settleTask(bytes32 taskId) external;
}
