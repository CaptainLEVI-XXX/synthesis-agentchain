// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Minimal EAS Attestation struct for Alkahest integration.
/// @dev Matches @ethereum-attestation-service/eas-contracts Attestation layout.
struct Attestation {
    bytes32 uid;
    bytes32 schema;
    uint64 time;
    uint64 expirationTime;
    uint64 revocationTime;
    bytes32 refUID;
    address attester;
    address recipient;
    bool revocable;
    bytes data;
}

/// @notice DelegationHop struct — must match DelegationTracker.DelegationHop exactly.
/// @dev Duplicated at file-level because Solidity requires local struct for cross-contract ABI decoding.
struct DelegationHop {
    address delegator;
    address delegate;
    uint8 depth;
    bytes32 delegationHash;
    uint256 timestamp;
}
