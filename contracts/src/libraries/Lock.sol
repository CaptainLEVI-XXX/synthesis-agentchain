// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Reentrancy guard using EIP-1153 transient storage (tstore/tload)
/// @dev Cheaper than OpenZeppelin's ReentrancyGuard (~100 gas vs ~2600 gas per check)
///      Default state (0) = unlocked. Set to 1 when locked. Transient storage resets each tx.
library Lock {
    bytes32 internal constant IS_LOCKED_SLOT = 0xc090fc4683624cfc3884e9d8de5eca132f2d0ec062aff75d43c0465d5ceeab23;

    error ContractLocked();

    function lock() internal {
        assembly ("memory-safe") { tstore(IS_LOCKED_SLOT, true) }
    }

    function unlock() internal {
        assembly ("memory-safe") { tstore(IS_LOCKED_SLOT, false) }
    }

    function isLocked() internal view returns (bool locked) {
        assembly ("memory-safe") { locked := tload(IS_LOCKED_SLOT) }
    }
}
