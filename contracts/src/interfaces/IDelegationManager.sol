// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice MetaMask DelegationManager interface — for checking revoked delegations.
interface IDelegationManager {
    function disabledDelegations(bytes32 delegationHash) external view returns (bool);
}
