// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Attestation} from "./ICommon.sol";

/// @notice Alkahest arbiter interface — verifies if escrow should be released.
interface IArbiter {
    function checkStatement(
        Attestation memory obligation,
        bytes memory demand,
        bytes32 counteroffer
    ) external view returns (bool);
}
