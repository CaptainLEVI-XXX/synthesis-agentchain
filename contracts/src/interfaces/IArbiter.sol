// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Attestation} from "./ICommon.sol";

/// @notice Alkahest arbiter interface — verifies if escrow should be released.
/// @dev Matches the Alkahest BaseEscrowObligation arbiter pattern.
///      Called by Alkahest during collectEscrowRaw() to verify fulfillment.
interface IArbiter {
    function checkObligation(
        Attestation memory obligation,
        bytes memory demand,
        bytes32 fulfilling
    ) external view returns (bool);
}
