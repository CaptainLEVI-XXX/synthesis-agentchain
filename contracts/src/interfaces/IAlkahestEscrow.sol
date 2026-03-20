// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Interface for Alkahest ERC20 Escrow Obligation contract.
/// @dev Matches the deployed ERC20EscrowObligation at 0x1Fe964348Ec42D9Bb1A072503ce8b4744266FF43 (Base Sepolia)
interface IAlkahestEscrow {
    struct ObligationData {
        address arbiter;
        bytes demand;
        address token;
        uint256 amount;
    }

    /// @notice Create an escrow — locks ERC20 tokens with release conditions.
    ///         Caller must approve this contract to spend `data.amount` of `data.token`.
    /// @param data Obligation data (arbiter, demand, token, amount)
    /// @param expirationTime Unix timestamp after which creator can reclaim
    /// @return uid The EAS attestation UID (escrow identifier)
    function doObligation(
        ObligationData calldata data,
        uint64 expirationTime
    ) external returns (bytes32 uid);

    /// @notice Create escrow on behalf of a specific recipient.
    ///         The recipient receives the escrowed tokens if the obligation is not fulfilled.
    /// @param data Obligation data (arbiter, demand, token, amount)
    /// @param expirationTime Unix timestamp after which recipient can reclaim
    /// @param recipient Address that can reclaim expired escrow
    /// @return uid The EAS attestation UID
    function doObligationFor(
        ObligationData calldata data,
        uint64 expirationTime,
        address recipient
    ) external returns (bytes32 uid);

    /// @notice Collect escrowed funds after fulfillment.
    ///         Calls arbiter.checkObligation() to verify conditions are met.
    ///         Funds released to fulfillment attestation's recipient field.
    /// @param escrow The escrow attestation UID
    /// @param fulfillment A fulfillment attestation referencing the escrow
    /// @return success Whether collection succeeded
    function collectEscrow(
        bytes32 escrow,
        bytes32 fulfillment
    ) external returns (bool);

    /// @notice Reclaim expired escrow funds.
    /// @param uid The escrow attestation UID to reclaim
    function reclaimExpired(bytes32 uid) external;
}

/// @notice Interface for EAS (Ethereum Attestation Service).
/// @dev EAS on Base: 0x4200000000000000000000000000000000000021
interface IEAS {
    struct AttestationRequest {
        bytes32 schema;
        AttestationRequestData data;
    }

    struct AttestationRequestData {
        address recipient;
        uint64 expirationTime;
        bool revocable;
        bytes32 refUID;
        bytes data;
        uint256 value;
    }

    function attest(AttestationRequest calldata request) external payable returns (bytes32);

    function getAttestation(bytes32 uid) external view returns (Attestation memory);

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
}
