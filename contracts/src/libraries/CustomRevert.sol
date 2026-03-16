// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title Gas-efficient custom error reverts using assembly
/// @dev Usage: `using CustomRevert for bytes4;` then `ErrorName.selector.revertWith()`
library CustomRevert {
    error WrappedError(address target, bytes4 selector, bytes reason, bytes details);

    function revertWith(bytes4 selector) internal pure {
        assembly ("memory-safe") { mstore(0, selector) revert(0, 0x04) }
    }

    function revertWith(bytes4 selector, address addr) internal pure {
        assembly ("memory-safe") {
            mstore(0, selector)
            mstore(0x04, and(addr, 0xffffffffffffffffffffffffffffffffffffffff))
            revert(0, 0x24)
        }
    }

    function revertWith(bytes4 selector, uint256 value) internal pure {
        assembly ("memory-safe") { mstore(0x00, selector) mstore(0x04, value) revert(0x00, 0x24) }
    }

    function revertWith(bytes4 selector, uint256 value1, uint256 value2) internal pure {
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(fmp, selector)
            mstore(add(fmp, 0x04), value1)
            mstore(add(fmp, 0x24), value2)
            revert(fmp, 0x44)
        }
    }

    function revertWith(bytes4 selector, address value1, address value2) internal pure {
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(fmp, selector)
            mstore(add(fmp, 0x04), and(value1, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(fmp, 0x24), and(value2, 0xffffffffffffffffffffffffffffffffffffffff))
            revert(fmp, 0x44)
        }
    }
}
