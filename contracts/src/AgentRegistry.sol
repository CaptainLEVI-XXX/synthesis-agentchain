// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";
import {Lock} from "./libraries/Lock.sol";

contract AgentRegistry {
    using SafeERC20 for IERC20;
    using CustomRevert for bytes4;

    error AlreadyRegistered(address agent);
    error NotRegistered(address agent);
    error NoCapabilities();
    error ZeroStake();
    error InsufficientStake(uint256 requested, uint256 available);
    error NotERC8004Owner(uint256 tokenId, address caller, address owner);

    IERC20 public immutable stakingToken;        // USDC
    IIdentityRegistry public immutable identity;  // ERC-8004 at 0x8004A169...
    address public deployer;                      // for deployment

    struct Agent {
        string name;
        bytes32[] capabilities;   // keccak256 hashes
        string endpoint;          // off-chain API URL
        uint256 erc8004Id;        // ERC-8004 identity NFT token ID
        string ensName;           // optional ENS name (e.g., "aave-scanner.eth") — display only
        uint256 registeredAt;
        bool active;
    }

    mapping(address => Agent) public agents;
    mapping(address => uint256) public stakes;
    mapping(bytes32 => address[]) public capabilityIndex; // cap hash → agent addresses


    event AgentRegistered(address indexed agent, string name, uint256 stake, uint256 erc8004Id);
    event AgentUpdated(address indexed agent);
    event AgentDeactivated(address indexed agent);
    event Staked(address indexed agent, uint256 amount);
    event Unstaked(address indexed agent, uint256 amount);
    event ENSNameLinked(address indexed agent, string ensName);

    constructor(address _stakingToken, address _identity) {
        stakingToken = IERC20(_stakingToken);
        identity = IIdentityRegistry(_identity);
        deployer = msg.sender;
    }


    modifier nonReentrant() {
        if (Lock.isLocked()) Lock.ContractLocked.selector.revertWith();
        Lock.lock();
        _;
        Lock.unlock();
    }

    modifier onlyRegistered() {
        if (!agents[msg.sender].active) NotRegistered.selector.revertWith(msg.sender);
        _;
    }


    /// @notice Register agent + stake in one call. Caller must approve stakingToken first.
    ///         Agent must already own an ERC-8004 identity NFT (register on the Identity Registry first).
    /// @param name Human-readable agent name
    /// @param erc8004Id Token ID of the agent's ERC-8004 identity NFT (caller must own it)
    /// @param capabilities keccak256 hashes of capability names
    /// @param endpoint Off-chain API URL
    /// @param stakeAmount USDC to stake (determines max task budget)
    function registerAndStake(
        string calldata name,
        uint256 erc8004Id,
        bytes32[] calldata capabilities,
        string calldata endpoint,
        uint256 stakeAmount
    ) external nonReentrant {
        if (agents[msg.sender].active) AlreadyRegistered.selector.revertWith(msg.sender);
        if (capabilities.length == 0) NoCapabilities.selector.revertWith();
        if (stakeAmount == 0) ZeroStake.selector.revertWith();

        _verifyERC8004Ownership(erc8004Id);
        _stake(stakeAmount);
        _register(name, erc8004Id, capabilities, endpoint);

        emit AgentRegistered(msg.sender, name, stakeAmount, erc8004Id);
    }

    /// @notice Register agent WITHOUT staking. Agent can stake later via addStake().
    ///         Agent must already own an ERC-8004 identity NFT.
    function register(
        string calldata name,
        uint256 erc8004Id,
        bytes32[] calldata capabilities,
        string calldata endpoint
    ) external {
        if (agents[msg.sender].active) AlreadyRegistered.selector.revertWith(msg.sender);
        if (capabilities.length == 0) NoCapabilities.selector.revertWith();
        _verifyERC8004Ownership(erc8004Id);
        _register(name, erc8004Id, capabilities, endpoint);
        emit AgentRegistered(msg.sender, name, 0, erc8004Id);
    }

    function _verifyERC8004Ownership(uint256 tokenId) internal view {
        address owner = identity.ownerOf(tokenId);
        if (owner != msg.sender) {
            revert NotERC8004Owner(tokenId, msg.sender, owner);
        }
    }

    function _register(
        string calldata name,
        uint256 erc8004Id,
        bytes32[] calldata capabilities,
        string calldata endpoint
    ) internal {
        agents[msg.sender] = Agent({
            name: name,
            capabilities: capabilities,
            endpoint: endpoint,
            erc8004Id: erc8004Id,
            ensName: "",
            registeredAt: block.timestamp,
            active: true
        });

        // Index capabilities for discovery
        for (uint i = 0; i < capabilities.length; i++) {
            capabilityIndex[capabilities[i]].push(msg.sender);
        }
    }

    function _stake(uint256 amount) internal {
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        stakes[msg.sender] += amount;  // fix H3: accumulate, don't overwrite
    }


    /// @notice Link an ENS name to this agent for display purposes.
    /// @dev — SDK resolves via ENS contracts directly.
    ///      Agent must already own this ENS name. We just store the string.
    /// @param ensName The ENS name (e.g., "aave-scanner.eth" or "myagent.base.eth")
    function linkENSName(string calldata ensName) external onlyRegistered {
        agents[msg.sender].ensName = ensName;
        emit ENSNameLinked(msg.sender, ensName);
    }

    /// @notice Add more stake. Increases max task budget agent can accept.
    function addStake(uint256 amount) external onlyRegistered nonReentrant {
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        stakes[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw stake. For hackathon: immediate withdrawal if no active tasks.
    function unstake(uint256 amount) external nonReentrant {
        if (stakes[msg.sender] < amount) {
            InsufficientStake.selector.revertWith(amount, stakes[msg.sender]);
        }
        stakes[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Update agent capabilities.
    /// @dev O(n*m) loops are fine — agents have 3-10 capabilities.
    function updateCapabilities(bytes32[] calldata newCapabilities) external onlyRegistered {
        if (newCapabilities.length == 0) NoCapabilities.selector.revertWith();

        // Remove old capability index entries
        bytes32[] storage oldCaps = agents[msg.sender].capabilities;
        for (uint i = 0; i < oldCaps.length; i++) {
            _removeFromIndex(oldCaps[i], msg.sender);
        }

        // Set new capabilities + re-index
        agents[msg.sender].capabilities = newCapabilities;
        for (uint i = 0; i < newCapabilities.length; i++) {
            capabilityIndex[newCapabilities[i]].push(msg.sender);
        }

        emit AgentUpdated(msg.sender);
    }

    /// @notice Update agent endpoint
    function updateEndpoint(string calldata newEndpoint) external onlyRegistered {
        agents[msg.sender].endpoint = newEndpoint;
        emit AgentUpdated(msg.sender);
    }

    /// @notice Deactivate agent (keeps stake, removes from discovery and capability index)
    function deactivate() external onlyRegistered {
        bytes32[] storage caps = agents[msg.sender].capabilities;
        for (uint i = 0; i < caps.length; i++) {
            _removeFromIndex(caps[i], msg.sender);
        }

        agents[msg.sender].active = false;
        emit AgentDeactivated(msg.sender);
    }


    /// @notice Find agents by capability. Off-chain indexer handles reputation filtering.
    function getAgentsByCapability(bytes32 capability) external view returns (address[] memory) {
        return capabilityIndex[capability];
    }

    function getAgent(address agent) external view returns (Agent memory) {
        return agents[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return agents[agent].active;
    }

    /// @notice Check if agent has all required capabilities
    function hasCapabilities(address agent, bytes32[] calldata caps) external view returns (bool) {
        if (!agents[agent].active) return false;
        bytes32[] storage agentCaps = agents[agent].capabilities;
        for (uint i = 0; i < caps.length; i++) {
            bool found = false;
            for (uint j = 0; j < agentCaps.length; j++) {
                if (agentCaps[j] == caps[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }

    function _removeFromIndex(bytes32 capability, address agent) internal {
        address[] storage list = capabilityIndex[capability];
        for (uint i = 0; i < list.length; i++) {
            if (list[i] == agent) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
    }
}
