// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice ERC-8004 Identity Registry — deployed at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
/// @dev Extends ERC-721; agents register directly and own their identity NFT.
interface IIdentityRegistry is IERC721 {
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function setMetadata(uint256 agentId, string memory key, bytes memory value) external;
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);
}
