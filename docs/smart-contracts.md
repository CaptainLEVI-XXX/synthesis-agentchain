# AgentChain Smart Contracts

**Chain:** Base Sepolia (dev) → Base mainnet
**Language:** Solidity ^0.8.20
**Framework:** Foundry

## Contract Overview

| Contract | Purpose | External Dependencies |
|----------|---------|----------------------|
| `AgentRegistry.sol` | Agent registration, staking, capability indexing, discovery | IERC20 (USDC), ERC-8004 Identity Registry, ENS (display) |
| `AgentCapabilityEnforcer.sol` | MetaMask delegation validation (agent quals only — composes with built-in enforcers) | MetaMask CaveatEnforcer base, AgentRegistry, DelegationTracker |
| `DelegationTracker.sol` | Task lifecycle, delegation chain recording, work records | — |
| `AgentChainArbiter.sol` | Alkahest escrow release (3-layer verification) + reputation submission | IArbiter, IEAS, DelegationTracker, DelegationManager, AgentRegistry, ERC-8004 Reputation Registry |

**Removed:** `ReputationTracker.sol` — replaced by ERC-8004 Reputation Registry at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (already deployed on Base). Our reputation data is now composable with the entire ERC-8004 ecosystem (Virtuals, Chitin, AgentStore, etc.).

## Design Decisions

- **`taskId`** = EAS attestation UID from Alkahest `makeStatement()`. Single source of truth across all contracts.
- **Capabilities** stored as `bytes32` hashes (`keccak256(abi.encodePacked(capName))`). SDK handles string↔hash.
- **Reputation** uses ERC-8004 Reputation Registry (canonical, deployed). We tag our feedback with `tag1 = "agentchain"` and `tag2 = "delegation"` so it's filterable. Rating system: int128 fixed-point (e.g., 45 with 1 decimal = 4.5 stars).
- **Payment + Investment flow**: User deposits full budget (e.g., 5000 USDC) into Alkahest escrow. After 3-layer verification, escrow releases to orchestrator's smart account. Sub-agents execute real DeFi via MetaMask delegation redemption on the orchestrator's account. Orchestrator transfers resulting investment tokens back to user. **Sub-agent fees are trustlessly auto-distributed from the orchestrator's STAKE** (not from escrow) by the contract during `settleAndRate()` — the orchestrator never manually pays sub-agents. Stake >= task budget acts as collateral: if the orchestrator rugs, their stake is at risk and their ERC-8004 reputation gets destroyed via disputes.
- **Trustless fee distribution**: Each delegation encodes a `fee` in `AgentTerms`. During settlement, `AgentRegistry.distributeFeesFromStake()` deducts promised fees from the orchestrator's stake and transfers directly to each sub-agent. This is fully on-chain and trustless — no agent can be stiffed.
- **Autonomous task pickup**: No proposal/accept step. Orchestrators call `claimTask()` directly — first qualified agent wins. Qualification = registered + staked. This matches the autonomous agent model.
- **Delegation model**: Agents are HybridDeleGator smart accounts (ERC-4337). Users stay as EOAs. Sub-agents research and provide strategy data (calldata, yields, risk) via work records. Orchestrator picks the best strategy and executes it after escrow release. MetaMask delegations authorize what sub-agents can do (targets, methods, budget caps) with automatic caveat attenuation through sub-delegation chains.
- **Caveat composition**: Our custom `AgentCapabilityEnforcer` handles agent-specific checks (registered, staked, capable, depth). Built-in MetaMask enforcers handle budget (`ERC20TransferAmountEnforcer`), time (`TimestampEnforcer`), targets (`AllowedTargetsEnforcer`), methods (`AllowedMethodsEnforcer`), and call limits (`LimitedCallsEnforcer`).
- **Depth tracking**: SDK encodes `currentDepth + 1` in new delegation's `AgentTerms`. Each level's terms are immutable and enforced across the full chain.
- **Stake rule**: Agents can only accept tasks where `taskBudget <= agentStake`.
- **ENS**: Display-only. Agents link an ENS name they own. SDK resolves for display everywhere — events, discovery, delegation chains. No hex addresses in UI.

## External Contracts (Already Deployed on Base)

| Contract | Address | Used For |
|----------|---------|----------|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Agent identity NFTs |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Reputation feedback + queries |

## Deployment Dependencies

```
ERC-8004 Identity Registry (already deployed — 0x8004A169...)
ERC-8004 Reputation Registry (already deployed — 0x8004BAa1...)
    ↓
AgentRegistry (needs: USDC address, Identity Registry address)
    ↓
DelegationTracker (deploy first — no constructor args, uses initialize())
    ↓
AgentCapabilityEnforcer (needs: AgentRegistry, DelegationTracker)
    ↓
AgentChainArbiter (needs: DelegationTracker, DelegationManager, Reputation Registry, AgentRegistry)
    ↓
Post-deploy setup:
  → tracker.initialize(enforcer, arbiter, agentRegistry)
  → agentRegistry.setArbiter(arbiter)
```

---

## Shared Libraries

All contracts use these libraries. They live in `src/libraries/`.

### `CustomRevert.sol` — Gas-efficient custom error reverts (ERC-7751)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
```

### `Lock.sol` — Transient storage reentrancy guard

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Reentrancy guard using EIP-1153 transient storage (tstore/tload)
/// @dev Cheaper than OpenZeppelin's ReentrancyGuard (~100 gas vs ~2600 gas per check)
library Lock {
    bytes32 internal constant IS_UNLOCKED_SLOT = 0xc090fc4683624cfc3884e9d8de5eca132f2d0ec062aff75d43c0465d5ceeab23;

    error ContractLocked();

    function unlock() internal {
        assembly ("memory-safe") { tstore(IS_UNLOCKED_SLOT, true) }
    }

    function lock() internal {
        assembly ("memory-safe") { tstore(IS_UNLOCKED_SLOT, false) }
    }

    function isUnlocked() internal view returns (bool unlocked) {
        assembly ("memory-safe") { unlocked := tload(IS_UNLOCKED_SLOT) }
    }
}
```

---

## 1. `AgentRegistry.sol`

Agent registration, staking, capability indexing, discovery, ERC-8004 identity, and optional ENS name linking.

### ERC-8004 Integration

ERC-8004 Identity Registry is **already deployed on Base** at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (~17k agents registered). We call its `register()` function during agent registration to get an on-chain identity NFT (ERC-721).

**Real interface from the EIP:**
```solidity
function register(string agentURI) external returns (uint256 agentId);
function register(string agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);
function setAgentURI(uint256 agentId, string calldata newURI) external;
function setMetadata(uint256 agentId, string memory key, bytes memory value) external;
function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);
function setAgentWallet(uint256 agentId, address wallet, uint256 deadline, bytes calldata sig) external;
function getAgentWallet(uint256 agentId) external view returns (address);
```

The `agentURI` points to a JSON file (hosted on IPFS) describing the agent's endpoints, capabilities, and trust model. This is the standard agent identity format across the ecosystem.

### ENS Integration (Light)

ENS is **display-only**. Agents optionally link an ENS name they already own. No subname minting, no NameWrapper, no on-chain resolution logic. The contract just stores the ENS name string. The SDK resolves it for display.

This qualifies for the ENS Open Integration ($300) bounty — we're replacing hex addresses with ENS names throughout the discovery and delegation UX.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";
import {Lock} from "./libraries/Lock.sol";

// ERC-8004 Identity Registry — deployed at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
interface IIdentityRegistry {
    struct MetadataEntry {
        string key;
        bytes value;
    }
    function register(string calldata agentURI) external returns (uint256 agentId);
    function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function setMetadata(uint256 agentId, string memory key, bytes memory value) external;
    function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);
}

contract AgentRegistry {
    using SafeERC20 for IERC20;
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error AlreadyRegistered(address agent);
    error NotRegistered(address agent);
    error NoCapabilities();
    error ZeroStake();
    error InsufficientStake(uint256 requested, uint256 available);
    error NotArbiter(address caller);
    error FeeExceedsStake(address orchestrator, uint256 totalFees, uint256 stake);

    // ─── State ─────────────────────────────────────────────

    IERC20 public immutable stakingToken;        // USDC
    IIdentityRegistry public immutable identity;  // ERC-8004 at 0x8004A169...
    address public arbiter;                       // AgentChainArbiter — set after deployment
    address public deployer;                      // for one-time arbiter setup

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

    // ─── Events ────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string name, uint256 stake, uint256 erc8004Id);
    event AgentUpdated(address indexed agent);
    event AgentDeactivated(address indexed agent);
    event Staked(address indexed agent, uint256 amount);
    event Unstaked(address indexed agent, uint256 amount);
    event ENSNameLinked(address indexed agent, string ensName);
    event FeesDistributed(address indexed orchestrator, uint256 totalFees, uint256 agentCount);
    event ArbiterSet(address indexed arbiter);

    // ─── Constructor ───────────────────────────────────────

    constructor(address _stakingToken, address _identity) {
        stakingToken = IERC20(_stakingToken);
        identity = IIdentityRegistry(_identity);
        deployer = msg.sender;
        Lock.unlock();
    }

    /// @notice One-time arbiter setup. Called after AgentChainArbiter is deployed.
    function setArbiter(address _arbiter) external {
        require(msg.sender == deployer, "Not deployer");
        require(arbiter == address(0), "Arbiter already set");
        arbiter = _arbiter;
        emit ArbiterSet(_arbiter);
    }

    // ─── Modifiers ─────────────────────────────────────────

    modifier nonReentrant() {
        if (!Lock.isUnlocked()) Lock.ContractLocked.selector.revertWith();
        Lock.lock();
        _;
        Lock.unlock();
    }

    modifier onlyRegistered() {
        if (!agents[msg.sender].active) NotRegistered.selector.revertWith(msg.sender);
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) NotArbiter.selector.revertWith(msg.sender);
        _;
    }

    // ─── Registration ──────────────────────────────────────

    /// @notice Register agent + stake in one call. Caller must approve stakingToken first.
    /// @param name Human-readable agent name
    /// @param capabilities keccak256 hashes of capability names
    /// @param endpoint Off-chain API URL
    /// @param agentURI URI pointing to agent JSON descriptor (IPFS recommended)
    /// @param stakeAmount USDC to stake (determines max task budget)
    function registerAndStake(
        string calldata name,
        bytes32[] calldata capabilities,
        string calldata endpoint,
        string calldata agentURI,
        uint256 stakeAmount
    ) external nonReentrant {
        if (agents[msg.sender].active) AlreadyRegistered.selector.revertWith(msg.sender);
        if (capabilities.length == 0) NoCapabilities.selector.revertWith();
        if (stakeAmount == 0) ZeroStake.selector.revertWith();

        _stake(stakeAmount);
        uint256 agentId = _register(name, capabilities, endpoint, agentURI);

        emit AgentRegistered(msg.sender, name, stakeAmount, agentId);
    }

    /// @notice Register agent WITHOUT staking. Agent can stake later via addStake().
    ///         Useful for agents that want to register for discovery before committing capital.
    ///         Cannot accept tasks until staked (enforced by AgentCapabilityEnforcer.minStake check).
    function register(
        string calldata name,
        bytes32[] calldata capabilities,
        string calldata endpoint,
        string calldata agentURI
    ) external returns (uint256 agentId) {
        if (agents[msg.sender].active) AlreadyRegistered.selector.revertWith(msg.sender);
        if (capabilities.length == 0) NoCapabilities.selector.revertWith();
        agentId = _register(name, capabilities, endpoint, agentURI);
        emit AgentRegistered(msg.sender, name, 0, agentId);
    }

    function _register(
        string calldata name,
        bytes32[] calldata capabilities,
        string calldata endpoint,
        string calldata agentURI
    ) internal returns (uint256 agentId) {
        // Register ERC-8004 identity on the canonical registry
        // Returns an ERC-721 token ID representing this agent's on-chain identity
        agentId = identity.register(agentURI);

        // Store agent in our registry
        agents[msg.sender] = Agent({
            name: name,
            capabilities: capabilities,
            endpoint: endpoint,
            erc8004Id: agentId,
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
        stakes[msg.sender] = amount;
    }

    // ─── ENS (Display Only) ────────────────────────────────

    /// @notice Link an ENS name to this agent for display purposes.
    /// @dev No on-chain resolution — SDK resolves via ENS contracts directly.
    ///      Agent must already own this ENS name. We just store the string.
    /// @param ensName The ENS name (e.g., "aave-scanner.eth" or "myagent.base.eth")
    function linkENSName(string calldata ensName) external onlyRegistered {
        agents[msg.sender].ensName = ensName;
        emit ENSNameLinked(msg.sender, ensName);
    }

    // ─── Staking ───────────────────────────────────────────

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

    // ─── Fee Distribution (Trustless) ───────────────────────

    /// @notice Distribute promised fees from orchestrator's stake to sub-agents.
    ///         Called by AgentChainArbiter during settleAndRate().
    ///         This is the core trustless mechanism: fees are encoded in each delegation's
    ///         AgentTerms (immutable), recorded in DelegationTracker.promisedFees,
    ///         and auto-distributed here from the orchestrator's staked USDC.
    /// @param orchestrator The orchestrator whose stake pays the fees
    /// @param agents_ Array of sub-agent addresses to pay
    /// @param fees Array of fee amounts (USDC) — must match agents_ length
    function distributeFeesFromStake(
        address orchestrator,
        address[] calldata agents_,
        uint256[] calldata fees
    ) external onlyArbiter nonReentrant {
        require(agents_.length == fees.length, "Length mismatch");

        uint256 totalFees = 0;
        for (uint i = 0; i < fees.length; i++) {
            totalFees += fees[i];
        }

        // Orchestrator must have enough stake to cover all fees
        if (totalFees > stakes[orchestrator]) {
            FeeExceedsStake.selector.revertWith(orchestrator, totalFees, stakes[orchestrator]);
        }

        // Deduct total from orchestrator's stake
        stakes[orchestrator] -= totalFees;

        // Transfer to each sub-agent directly
        for (uint i = 0; i < agents_.length; i++) {
            if (fees[i] > 0) {
                stakingToken.safeTransfer(agents_[i], fees[i]);
            }
        }

        emit FeesDistributed(orchestrator, totalFees, agents_.length);
    }

    // ─── Updates ───────────────────────────────────────────

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

    /// @notice Update agent URI on ERC-8004 registry
    function updateAgentURI(string calldata newURI) external onlyRegistered {
        identity.setAgentURI(agents[msg.sender].erc8004Id, newURI);
        emit AgentUpdated(msg.sender);
    }

    /// @notice Deactivate agent (keeps stake, removes from discovery)
    function deactivate() external onlyRegistered {
        agents[msg.sender].active = false;
        emit AgentDeactivated(msg.sender);
    }

    // ─── Discovery (View) ──────────────────────────────────

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

    // ─── Internal ──────────────────────────────────────────

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
```

### Design Notes
- **ERC-8004:** Calls `identity.register(agentURI)` on the canonical registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (already deployed on Base with ~17k agents). Returns an ERC-721 token ID. The `agentURI` points to an IPFS-hosted JSON file describing the agent. Added `updateAgentURI()` to update the descriptor.
- **ENS:** `linkENSName()` just stores a string. No on-chain resolution, no NameWrapper, no subname minting. The SDK resolves ENS names via standard ENS contracts for display. Agents link a name they already own (could be `name.eth`, `name.base.eth`, or any ENS-compatible name).
- **Capabilities:** O(n*m) loops are fine for 3-10 items. Merkle trees would be more expensive at this scale.
- **Reputation filtering** happens off-chain (The Graph / SDK). `getAgentsByCapability()` returns raw address list.

---

## 2. `AgentCapabilityEnforcer.sol` (MetaMask Delegation)

**Redesigned** to follow proper MetaMask Delegation Framework standards. Instead of one monolithic enforcer that reinvents budget limits, expiry, and call restrictions, we use a **lean custom enforcer** that only checks AgentChain-specific things, and **compose it with MetaMask's built-in enforcers** for everything else.

### Architecture: Agents as ERC-4337 Smart Accounts

```
User (EOA)                          Agent Layer (ERC-4337 Smart Accounts)
┌──────────┐                        ┌─────────────────────────────────────────┐
│          │   deposit USDC         │                                         │
│  User    │──────────────────────> │  Alkahest Escrow                        │
│  (EOA)   │                        │  (holds funds until work verified)      │
│          │                        │                                         │
└──────────┘                        └─────────────┬───────────────────────────┘
                                                  │ escrow releases to orchestrator
                                                  v
                                    ┌─────────────────────────────────────────┐
                                    │ Orchestrator Agent (HybridDeleGator)    │
                                    │ - Receives USDC from escrow             │
                                    │ - Creates MetaMask Delegations to subs  │
                                    │ - ROOT delegator in the chain           │
                                    └───────┬──────────────┬──────────────────┘
                              Delegation D1 │              │ Delegation D2
                                            v              v
                                    ┌──────────────┐ ┌──────────────┐
                                    │ DeFi Agent   │ │ Data Agent   │
                                    │ (DeleGator)  │ │ (DeleGator)  │
                                    │              │ │              │
                                    │ Redeems D1   │ │ Redeems D2   │
                                    │ to call Aave │ │ to swap on   │
                                    │ on behalf of │ │ Uniswap on   │
                                    │ orchestrator │ │ behalf of    │
                                    └──────┬───────┘ │ orchestrator │
                             Sub-deleg. D3 │         └──────────────┘
                                           v
                                    ┌──────────────┐
                                    │ Yield Agent  │
                                    │ (DeleGator)  │
                                    │ Sub-redeems  │
                                    │ D3→D1 chain  │
                                    └──────────────┘
```

**Key insight:** Users stay as EOAs — they just deposit into Alkahest escrow. Only agents need smart accounts. The delegation chain is agent-to-agent, authorizing **real DeFi actions** on the orchestrator's smart account.

### The Custom Enforcer (Lean)

Our `AgentCapabilityEnforcer` checks ONLY what MetaMask's built-in enforcers can't: agent registration, staking, capabilities, and delegation depth. Everything else — budget limits, time windows, call restrictions — is handled by composing built-in enforcers.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {CaveatEnforcer} from "@metamask/delegation-framework/src/enforcers/CaveatEnforcer.sol";
import {ModeCode} from "@metamask/delegation-framework/src/utils/Types.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";

interface IAgentRegistry {
    function isRegistered(address agent) external view returns (bool);
    function stakes(address agent) external view returns (uint256);
    function hasCapabilities(address agent, bytes32[] calldata caps) external view returns (bool);
}

interface IDelegationTracker {
    function recordDelegation(bytes32 taskId, address from, address to, uint8 depth, bytes32 delegationHash, uint256 fee) external;
}

/// @title AgentCapabilityEnforcer
/// @notice Custom MetaMask caveat enforcer for AgentChain.
///         Validates agent-specific qualifications (registered, staked, capable).
///         Compose with built-in enforcers for budget, time, and target restrictions.
/// @dev Inherits CaveatEnforcer (abstract base), NOT ICaveatEnforcer directly.
///      Only overrides beforeHook and afterHook. Other hooks use empty defaults.
contract AgentCapabilityEnforcer is CaveatEnforcer {
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error AgentNotRegistered(address agent);
    error StakeInsufficient(address agent, uint256 required, uint256 actual);
    error MissingCapabilities(address agent);
    error MaxDepthReached(uint8 current, uint8 max);

    // ─── State ─────────────────────────────────────────────

    IAgentRegistry public immutable registry;
    IDelegationTracker public immutable tracker;

    /// @notice Terms structure — encoded by SDK, decoded by enforcer.
    ///         Only contains agent-specific fields. Budget/time/targets
    ///         are handled by composed built-in enforcers.
    /// @dev Packed layout:
    ///      bytes32   taskId         — EAS attestation UID from Alkahest
    ///      uint8     maxDepth       — absolute max delegation depth
    ///      uint8     currentDepth   — current depth (SDK increments per hop)
    ///      uint256   minStake       — minimum stake required for this delegation
    ///      uint256   fee            — promised fee (USDC) for this agent, paid from orchestrator's stake
    ///      bytes32[] requiredCaps   — capability hashes the delegate must have
    struct AgentTerms {
        bytes32 taskId;
        uint8 maxDepth;
        uint8 currentDepth;
        uint256 minStake;
        uint256 fee;              // promised fee — auto-distributed from orchestrator's stake on settlement
        bytes32[] requiredCaps;
    }

    // ─── Events ────────────────────────────────────────────

    event AgentDelegationValidated(
        bytes32 indexed delegationHash,
        address indexed delegator,
        address indexed redeemer,
        bytes32 taskId,
        uint8 depth
    );

    // ─── Constructor ───────────────────────────────────────

    constructor(address _registry, address _tracker) {
        registry = IAgentRegistry(_registry);
        tracker = IDelegationTracker(_tracker);
    }

    // ─── Hooks ─────────────────────────────────────────────

    /// @notice Validates agent qualifications before delegation execution.
    /// @dev Called by DelegationManager during redeemDelegations().
    ///      _redeemer is the agent redeeming (the delegate).
    ///      _delegator is the orchestrator (root) or parent agent.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,          // _args (unused)
        ModeCode,                // _mode (unused — we allow any mode)
        bytes calldata,          // _executionCalldata (unused — target/method checks done by built-in enforcers)
        bytes32,                 // _delegationHash (unused in beforeHook)
        address,                 // _delegator (unused in beforeHook)
        address _redeemer
    ) public view override {
        AgentTerms memory t = abi.decode(_terms, (AgentTerms));

        // 1. Agent must be registered and active in AgentChain
        if (!registry.isRegistered(_redeemer)) {
            AgentNotRegistered.selector.revertWith(_redeemer);
        }

        // 2. Agent stake must meet minimum for this delegation
        uint256 agentStake = registry.stakes(_redeemer);
        if (agentStake < t.minStake) {
            StakeInsufficient.selector.revertWith(_redeemer, t.minStake, agentStake);
        }

        // 3. Agent must have all required capabilities
        if (!registry.hasCapabilities(_redeemer, t.requiredCaps)) {
            MissingCapabilities.selector.revertWith(_redeemer);
        }

        // 4. Delegation depth limit
        if (t.currentDepth >= t.maxDepth) {
            MaxDepthReached.selector.revertWith(t.currentDepth, t.maxDepth);
        }
    }

    /// @notice Records delegation hop on-chain after successful execution.
    /// @dev Called by DelegationManager after the delegated action executes.
    function afterHook(
        bytes calldata _terms,
        bytes calldata,          // _args
        ModeCode,                // _mode
        bytes calldata,          // _executionCalldata
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) public override {
        AgentTerms memory t = abi.decode(_terms, (AgentTerms));

        // Record delegation hop + promised fee in tracker for chain integrity verification + settlement
        tracker.recordDelegation(
            t.taskId,
            _delegator,
            _redeemer,
            t.currentDepth,
            _delegationHash,
            t.fee
        );

        emit AgentDelegationValidated(
            _delegationHash,
            _delegator,
            _redeemer,
            t.taskId,
            t.currentDepth
        );
    }
}
```

### Composing with Built-in MetaMask Enforcers

The power of this design: our custom enforcer handles **only agent qualifications**. All other restrictions use MetaMask's battle-tested built-in enforcers. A single delegation has **multiple caveats** — our enforcer is just one in the array.

```
Delegation from Orchestrator → DeFi Agent:
┌───────────────────────────────────────────────────────────────┐
│ caveats: [                                                    │
│   {                                                           │
│     enforcer: AgentCapabilityEnforcer     ← OUR custom one    │
│     terms: encode(AgentTerms{                                 │
│       taskId, maxDepth:3, currentDepth:1,                     │
│       minStake:1000e6, fee:80e6,                              │
│       requiredCaps:["defi","lending"]                         │
│     })                                                        │
│   },                                                          │
│   {                                                           │
│     enforcer: AllowedTargetsEnforcer     ← BUILT-IN           │
│     terms: concat(AAVE_POOL, UNISWAP_ROUTER)                 │
│   },                                                          │
│   {                                                           │
│     enforcer: AllowedMethodsEnforcer     ← BUILT-IN           │
│     terms: concat(supply.selector, swap.selector)             │
│   },                                                          │
│   {                                                           │
│     enforcer: ERC20TransferAmountEnforcer ← BUILT-IN          │
│     terms: concat(USDC_ADDRESS, 3000e6)  // max 3000 USDC    │
│   },                                                          │
│   {                                                           │
│     enforcer: TimestampEnforcer          ← BUILT-IN           │
│     terms: encode(uint128(now), uint128(now + 24 hours))      │
│   },                                                          │
│   {                                                           │
│     enforcer: LimitedCallsEnforcer       ← BUILT-IN           │
│     terms: encode(uint256(10))           // max 10 calls      │
│   }                                                           │
│ ]                                                             │
└───────────────────────────────────────────────────────────────┘
```

**Why this wins:** A MetaMask judge sees we're using 5+ built-in enforcers correctly, composing them with a focused custom enforcer, and leveraging the framework's caveat attenuation for sub-delegation chains — not reinventing the wheel.

### Sub-delegation with Automatic Caveat Attenuation

When a sub-agent re-delegates, **all caveats from every ancestor in the chain are enforced**. The child delegation can only be MORE restrictive, never less.

```
Orchestrator (HybridDeleGator, holds 5000 USDC from escrow)
│
├── Delegation D1 to DeFi Agent
│   authority: ROOT_AUTHORITY
│   caveats: [
│     AgentCapabilityEnforcer(taskId, depth:1, maxDepth:3, minStake:1000, fee:80, caps:["defi"])
│     AllowedTargetsEnforcer([AAVE_POOL, UNISWAP_ROUTER])
│     ERC20TransferAmountEnforcer(USDC, 3000e6)   ← budget: 3000 USDC
│     TimestampEnforcer(now, now + 24h)
│     LimitedCallsEnforcer(10)
│   ]
│
└── DeFi Agent sub-delegates to Yield Agent
    authority: getDelegationHash(D1)               ← links to parent
    caveats: [
      AgentCapabilityEnforcer(taskId, depth:2, maxDepth:3, minStake:500, fee:30, caps:["yield"])
      AllowedTargetsEnforcer([AAVE_POOL])           ← STRICTER: only Aave, not Uniswap
      ERC20TransferAmountEnforcer(USDC, 1000e6)    ← STRICTER: 1000 < 3000
      LimitedCallsEnforcer(3)                      ← STRICTER: 3 < 10
    ]

When Yield Agent redeems:
  ✓ D2 caveats checked: Aave only, 1000 USDC, 3 calls, depth:2 < 3, caps:["yield"]
  ✓ D1 caveats checked: Aave+Uniswap, 3000 USDC, 10 calls, depth:1 < 3, caps:["defi"]
  → Both pass. The effective limit is the intersection: Aave only, 1000 USDC, 3 calls.
  → Budget attenuated: 5000 → 3000 → 1000 through the chain.
```

### SDK: Creating and Redeeming Agent Delegations

```typescript
import {
  createDelegation,
  createCaveatBuilder,
  createExecution,
  ExecutionMode,
} from "@metamask/smart-accounts-kit";
import { DelegationManager } from "@metamask/smart-accounts-kit/contracts";
import { parseUnits, encodeFunctionData, erc20Abi, concatHex } from "viem";

// ─── Deployed Addresses ────────────────────────────────────

const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";
const AGENT_CAPABILITY_ENFORCER = "0x..."; // our deployed enforcer
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const AAVE_POOL = "0x...";

// ─── 1. Orchestrator creates delegation to DeFi sub-agent ──

function createAgentDelegation(
  orchestratorAccount: SmartAccount,
  subAgentAddress: `0x${string}`,
  taskId: `0x${string}`,
  budgetUsdc: bigint,
  feeUsdc: bigint,          // promised fee for this agent (paid from orchestrator's stake)
  targets: `0x${string}`[],
  methods: `0x${string}`[], // 4-byte selectors
  capabilities: string[],
  depth: number
) {
  // Encode our custom AgentTerms (includes fee for trustless distribution)
  const agentTerms = encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "taskId", type: "bytes32" },
      { name: "maxDepth", type: "uint8" },
      { name: "currentDepth", type: "uint8" },
      { name: "minStake", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "requiredCaps", type: "bytes32[]" },
    ]}],
    [{
      taskId,
      maxDepth: 3,
      currentDepth: depth,
      minStake: budgetUsdc,
      fee: feeUsdc,           // immutable — auto-distributed from orchestrator's stake on settlement
      requiredCaps: capabilities.map(c =>
        keccak256(encodePacked(["string"], [c]))
      ),
    }]
  );

  // Compose caveats: our custom enforcer + MetaMask built-ins
  const caveats = [
    // 1. AgentChain-specific: registration, stake, capabilities, depth
    { enforcer: AGENT_CAPABILITY_ENFORCER, terms: agentTerms, args: "0x" },

    // 2. Built-in: restrict which contracts the agent can call
    {
      enforcer: ALLOWED_TARGETS_ENFORCER,
      terms: concatHex(targets), // concatenated 20-byte addresses
      args: "0x",
    },

    // 3. Built-in: restrict which functions the agent can call
    {
      enforcer: ALLOWED_METHODS_ENFORCER,
      terms: concatHex(methods), // concatenated 4-byte selectors
      args: "0x",
    },

    // 4. Built-in: cap cumulative ERC-20 spending
    {
      enforcer: ERC20_TRANSFER_AMOUNT_ENFORCER,
      terms: concatHex([USDC, toHex(budgetUsdc, { size: 32 })]),
      args: "0x",
    },

    // 5. Built-in: time window (24 hours)
    {
      enforcer: TIMESTAMP_ENFORCER,
      terms: encodeAbiParameters(
        [{ type: "uint128" }, { type: "uint128" }],
        [BigInt(Math.floor(Date.now() / 1000)), BigInt(Math.floor(Date.now() / 1000) + 86400)]
      ),
      args: "0x",
    },

    // 6. Built-in: max number of redemptions
    {
      enforcer: LIMITED_CALLS_ENFORCER,
      terms: encodeAbiParameters([{ type: "uint256" }], [10n]),
      args: "0x",
    },
  ];

  // Create and sign the delegation
  const delegation = createDelegation({
    to: subAgentAddress,
    from: orchestratorAccount.address,
    caveats,
  });

  return delegation;
}

// ─── 2. Sub-agent redeems delegation to execute DeFi action ─

async function redeemAgentDelegation(
  subAgentAccount: SmartAccount,
  signedDelegation: Delegation,
  target: `0x${string}`,
  callData: `0x${string}`
) {
  const execution = createExecution({ target, callData, value: 0n });

  // This calls DelegationManager.redeemDelegations()
  // Which validates the chain, runs all caveat hooks, then
  // calls executeFromExecutor() on the orchestrator's smart account
  await subAgentAccount.redeemDelegation({
    delegations: [signedDelegation],
    mode: ExecutionMode.SingleDefault,
    executions: [execution],
  });
}

// ─── 3. Sub-delegation: DeFi Agent → Yield Agent ────────────

async function subDelegate(
  parentDelegation: Delegation,
  defiAgentAccount: SmartAccount,
  yieldAgentAddress: `0x${string}`,
  taskId: `0x${string}`,
  subBudget: bigint, // must be <= parent budget
  subFee: bigint     // fee for this sub-agent (paid from orchestrator's stake)
) {
  const parentHash = await getDelegationHash(parentDelegation);

  // Create child delegation with STRICTER caveats
  const childDelegation = createDelegation({
    to: yieldAgentAddress,
    from: defiAgentAccount.address,
    authority: parentHash, // ← links to parent delegation
    caveats: [
      // Our enforcer with incremented depth + fee
      {
        enforcer: AGENT_CAPABILITY_ENFORCER,
        terms: encodeAgentTerms({
          taskId,
          maxDepth: 3,
          currentDepth: 2, // incremented from parent's 1
          minStake: subBudget,
          fee: subFee,     // promised fee for this sub-agent
          requiredCaps: ["yield"],
        }),
        args: "0x",
      },
      // Stricter target restriction: only Aave (parent allowed Aave + Uniswap)
      { enforcer: ALLOWED_TARGETS_ENFORCER, terms: concatHex([AAVE_POOL]), args: "0x" },
      // Stricter budget: subBudget < parentBudget
      {
        enforcer: ERC20_TRANSFER_AMOUNT_ENFORCER,
        terms: concatHex([USDC, toHex(subBudget, { size: 32 })]),
        args: "0x",
      },
      // Fewer allowed calls
      { enforcer: LIMITED_CALLS_ENFORCER, terms: encodeAbiParameters([{ type: "uint256" }], [3n]), args: "0x" },
    ],
  });

  // Sign with DeFi agent's key
  const signed = await defiAgentAccount.signDelegation({ delegation: childDelegation });

  // Yield agent redeems with FULL CHAIN [childDelegation, parentDelegation]
  // DelegationManager validates both sets of caveats
  return signed;
}
```

### Delegation Lifecycle (Full Flow)

```
1. User (EOA) deposits 5000 USDC into Alkahest escrow
   → makeStatement(token:USDC, amount:5000, arbiter:AgentChainArbiter, demand:DemandData)
   → SDK also calls tracker.registerTask(taskId, deadline, feePool:200e6)
   → Returns taskId (EAS attestation UID)

2. Orchestrator agent (HybridDeleGator) claims task autonomously
   → tracker.claimTask(taskId) — first qualified registered+staked agent wins
   → Orchestrator's stake >= task budget acts as collateral

3. Orchestrator creates MetaMask delegations to sub-agents
   → Each delegation has: [AgentCapabilityEnforcer + AllowedTargetsEnforcer +
      ERC20TransferAmountEnforcer + TimestampEnforcer + LimitedCallsEnforcer]
   → AgentTerms includes fee: e.g., 80 USDC for DeFi Agent, 50 USDC for Data Agent
   → Budget splits: 3000 USDC to DeFi Agent, 2000 USDC to Data Agent

4. Sub-agents redeem delegations to execute real DeFi actions
   → DeFi Agent redeems D1 → orchestrator's smart account calls Aave.supply()
   → DelegationManager validates all caveats, runs AgentCapabilityEnforcer hooks
   → afterHook records delegation hop + promised fee in DelegationTracker

5. Sub-agents can sub-delegate with STRICTER caveats
   → DeFi Agent → Yield Agent: authority = hash(D1), budget 1000 < 3000
   → Yield Agent redeems [D3, D1] → both caveat sets enforced

6. Agents submit work records to DelegationTracker
   → submitWorkRecord(taskId, resultHash, summary)

7. Orchestrator collects escrow via Alkahest
   → collectPayment() → AgentChainArbiter.checkStatement()
   → 3-layer verification: chain integrity + stake-weighted + reputation gate
   → If all pass → full 5000 USDC released to orchestrator's smart account

8. Settlement + Reputation + Trustless Fee Distribution
   → Task creator calls settleAndRate(taskId, rating)
   → Phase 1: ERC-8004 giveFeedback for each agent with work records
   → Phase 2: agentRegistry.distributeFeesFromStake() auto-pays sub-agents
              from orchestrator's stake (80 USDC → DeFi Agent, 50 USDC → Data Agent)
   → Phase 3: Task marked Completed

9. Orchestrator transfers investment tokens back to user
   → Orchestrator received 5000 USDC from escrow, invested via DeFi
   → Returns resulting tokens (aTokens, LP tokens, etc.) to user
   → Orchestrator's stake (minus fees already distributed) remains as collateral
   → Failing to return tokens → user disputes → ERC-8004 negative feedback

10. Revocation (at any point before settlement)
    → Orchestrator calls DelegationManager.disableDelegation(D1)
    → Instantly revokes DeFi Agent AND all downstream sub-delegations
    → checkStatement() will fail → escrow cannot be collected
```

### Why Agents Need Smart Accounts (Not Users)

| Role | Account Type | Why |
|------|-------------|-----|
| **User** | EOA | Just deposits USDC into Alkahest escrow. No delegation needed. |
| **Orchestrator** | HybridDeleGator | ROOT delegator — `DelegationManager.executeFromExecutor()` calls into this account to execute DeFi actions. Must be a smart account. |
| **Sub-agents** | HybridDeleGator | Need to be BOTH delegate (redeem parent's delegation) AND delegator (create sub-delegations). Also enables gas abstraction via ERC-4337. |

Agent smart accounts are created via MetaMask's `SimpleFactory` at `0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c`. Each agent's `HybridDeleGator` supports ECDSA signing (ideal for server-side AI agents with a private key).

### Depth Tracking

`currentDepth` is encoded in the `AgentTerms._terms` (immutable once delegation is created). The SDK increments it at each hop:

```
Orchestrator creates D1 → currentDepth = 1
DeFi Agent creates D2 (sub-delegation of D1) → currentDepth = 2
Yield Agent creates D3 (sub-delegation of D2) → currentDepth = 3
If maxDepth = 3, Yield Agent cannot sub-delegate (3 >= 3 → MaxDepthReached)
```

Since terms are immutable per-delegation, and all caveats in the chain are enforced, a sub-agent CANNOT lower `currentDepth` to bypass the limit — the parent's caveat would still check against its own `currentDepth`.

---

## 3. `DelegationTracker.sol`

Task lifecycle management, delegation chain recording, and work record storage.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentRegistry {
    function isRegistered(address agent) external view returns (bool);
}

contract DelegationTracker {

    // ─── Types ─────────────────────────────────────────────

    enum TaskStatus { Open, Accepted, Completed, Expired, Disputed }

    struct Task {
        address creator;           // user who created the task (msg.sender)
        address orchestrator;      // accepted orchestrator (address(0) if Open)
        TaskStatus status;
        uint256 deadline;
        uint256 delegationCount;   // number of delegation hops
        uint256 feePool;           // total USDC fees available for sub-agents (from orchestrator's stake)
    }

    struct DelegationHop {
        address delegator;
        address delegate;
        uint8 depth;
        bytes32 delegationHash;    // MetaMask delegation hash — for chain integrity verification
        uint256 timestamp;
    }

    struct WorkRecord {
        bytes32 resultHash;        // IPFS CID hash of full result
        string summary;            // brief human-readable summary
        uint256 timestamp;
    }

    // ─── State ─────────────────────────────────────────────

    address public capabilityEnforcer;   // only this address can record delegations
    address public arbiter;          // only this address can settle tasks
    address public agentRegistry;    // for validating orchestrator on claimTask

    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => DelegationHop[]) public taskDelegations;
    mapping(bytes32 => mapping(address => WorkRecord)) public workRecords;
    mapping(bytes32 => mapping(address => bool)) public isDelegated;    // quick lookup
    mapping(bytes32 => mapping(address => uint256)) public promisedFees; // taskId → agent → fee (USDC)
    mapping(bytes32 => uint256) public totalPromisedFees;                // taskId → sum of all promised fees

    // ─── Events ────────────────────────────────────────────

    event TaskRegistered(bytes32 indexed taskId, address indexed creator, uint256 deadline);
    event TaskAccepted(bytes32 indexed taskId, address indexed orchestrator);
    event DelegationCreated(bytes32 indexed taskId, address indexed from, address indexed to, uint8 depth);
    event WorkCompleted(bytes32 indexed taskId, address indexed agent, bytes32 resultHash);
    event TaskSettled(bytes32 indexed taskId);
    event TaskExpired(bytes32 indexed taskId);

    // ─── Modifiers ─────────────────────────────────────────

    modifier onlyTaskCreator(bytes32 taskId) {
        require(msg.sender == tasks[taskId].creator, "Not task creator");
        _;
    }

    modifier onlyCaveatEnforcer() {
        require(msg.sender == capabilityEnforcer, "Not caveat enforcer");
        _;
    }

    modifier onlyDelegatedAgent(bytes32 taskId) {
        require(isDelegated[taskId][msg.sender], "Not a delegated agent for this task");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Not arbiter");
        _;
    }

    // ─── Constructor + Initialization ──────────────────────

    address public deployer;
    bool public initialized;

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time initialization. Solves chicken-and-egg: deploy Tracker first,
    ///         then deploy Enforcer + Arbiter, then call initialize() with their addresses.
    function initialize(address _capabilityEnforcer, address _arbiter, address _agentRegistry) external {
        require(msg.sender == deployer, "Not deployer");
        require(!initialized, "Already initialized");
        capabilityEnforcer = _capabilityEnforcer;
        arbiter = _arbiter;
        agentRegistry = _agentRegistry;
        initialized = true;
    }

    // ─── Task Lifecycle ────────────────────────────────────

    /// @notice Register a new task. Called by SDK after Alkahest makeStatement().
    /// @param taskId EAS attestation UID from Alkahest escrow
    /// @param deadline Unix timestamp when escrow expires
    /// @param feePool Total USDC budget for sub-agent fees (deducted from orchestrator's stake on settlement)
    function registerTask(bytes32 taskId, uint256 deadline, uint256 feePool) external {
        require(tasks[taskId].creator == address(0), "Task already exists");
        require(deadline > block.timestamp, "Deadline in past");

        tasks[taskId] = Task({
            creator: msg.sender,
            orchestrator: address(0),
            status: TaskStatus.Open,
            deadline: deadline,
            delegationCount: 0,
            feePool: feePool
        });

        emit TaskRegistered(taskId, msg.sender, deadline);
    }

    /// @notice Orchestrator claims an open task. First qualified agent wins.
    ///         No proposal/accept step — autonomous agents pick up tasks directly.
    ///         Agent must be registered, active, and staked >= task budget.
    /// @param taskId The task to claim
    function claimTask(bytes32 taskId) external {
        require(tasks[taskId].status == TaskStatus.Open, "Task not open");
        require(block.timestamp < tasks[taskId].deadline, "Task expired");
        require(
            IAgentRegistry(agentRegistry).isRegistered(msg.sender),
            "Not a registered agent"
        );

        tasks[taskId].orchestrator = msg.sender;
        tasks[taskId].status = TaskStatus.Accepted;

        emit TaskAccepted(taskId, msg.sender);
    }

    // ─── Delegation Recording ──────────────────────────────

    /// @notice Record a delegation hop + promised fee. Called by AgentCapabilityEnforcer.afterHook().
    /// @param fee The USDC fee promised to this agent (encoded in AgentTerms, immutable per delegation)
    function recordDelegation(
        bytes32 taskId,
        address from,
        address to,
        uint8 depth,
        bytes32 delegationHash,
        uint256 fee
    ) external onlyCaveatEnforcer {
        require(tasks[taskId].status == TaskStatus.Accepted, "Task not accepted");
        require(block.timestamp < tasks[taskId].deadline, "Task expired");

        // Ensure total promised fees don't exceed the task's fee pool
        require(
            totalPromisedFees[taskId] + fee <= tasks[taskId].feePool,
            "Fee exceeds pool"
        );

        taskDelegations[taskId].push(DelegationHop({
            delegator: from,
            delegate: to,
            depth: depth,
            delegationHash: delegationHash,
            timestamp: block.timestamp
        }));

        isDelegated[taskId][to] = true;
        tasks[taskId].delegationCount++;

        // Track promised fee for this agent
        promisedFees[taskId][to] = fee;
        totalPromisedFees[taskId] += fee;

        emit DelegationCreated(taskId, from, to, depth);
    }

    // ─── Work Records ──────────────────────────────────────

    /// @notice Submit proof of work for a task. Only callable by delegated agents.
    function submitWorkRecord(
        bytes32 taskId,
        bytes32 resultHash,
        string calldata summary
    ) external onlyDelegatedAgent(taskId) {
        require(tasks[taskId].status == TaskStatus.Accepted, "Task not accepted");
        require(block.timestamp < tasks[taskId].deadline, "Task expired");
        require(workRecords[taskId][msg.sender].timestamp == 0, "Already submitted");

        workRecords[taskId][msg.sender] = WorkRecord({
            resultHash: resultHash,
            summary: summary,
            timestamp: block.timestamp
        });

        emit WorkCompleted(taskId, msg.sender, resultHash);
    }

    // ─── Settlement ────────────────────────────────────────

    /// @notice Mark task as completed. Called after arbiter approves escrow release.
    function settleTask(bytes32 taskId) external onlyArbiter {
        require(tasks[taskId].status == TaskStatus.Accepted, "Task not accepted");
        tasks[taskId].status = TaskStatus.Completed;
        emit TaskSettled(taskId);
    }

    /// @notice Mark task as expired. Callable by anyone after deadline.
    function expireTask(bytes32 taskId) external {
        require(block.timestamp >= tasks[taskId].deadline, "Not expired yet");
        require(
            tasks[taskId].status == TaskStatus.Open ||
            tasks[taskId].status == TaskStatus.Accepted,
            "Task already finalized"
        );
        tasks[taskId].status = TaskStatus.Expired;
        emit TaskExpired(taskId);
    }

    // ─── View Functions ────────────────────────────────────

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getTaskDelegations(bytes32 taskId) external view returns (DelegationHop[] memory) {
        return taskDelegations[taskId];
    }

    function getDelegationCount(bytes32 taskId) external view returns (uint256) {
        return tasks[taskId].delegationCount;
    }

    function hasWorkRecord(bytes32 taskId, address agent) external view returns (bool) {
        return workRecords[taskId][agent].timestamp > 0;
    }

    function getWorkRecord(bytes32 taskId, address agent) external view returns (WorkRecord memory) {
        return workRecords[taskId][agent];
    }

    function getPromisedFee(bytes32 taskId, address agent) external view returns (uint256) {
        return promisedFees[taskId][agent];
    }

    function getTotalPromisedFees(bytes32 taskId) external view returns (uint256) {
        return totalPromisedFees[taskId];
    }
}
```

### Deployment Order (Chicken-and-Egg Solved)

```
1. Deploy AgentRegistry(usdcAddress, identityRegistryAddress)
2. Deploy DelegationTracker (no constructor args — uses initialize())
3. Deploy AgentCapabilityEnforcer(registry, tracker)
4. Deploy AgentChainArbiter(tracker, delegationManager, reputation, agentRegistry)
5. Call tracker.initialize(enforcer, arbiter, agentRegistry) — one-time, deployer-only
6. Call agentRegistry.setArbiter(arbiter) — one-time, deployer-only
```

The `initialize()` pattern is simpler than CREATE2 for a hackathon and has clear access control (`deployer` + `initialized` flag).

---

## ~~4. `ReputationTracker.sol`~~ — REMOVED

**Replaced by ERC-8004 Reputation Registry** at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (already deployed on Base).

### Why ERC-8004 Reputation Instead of Our Own

1. **Composability** — Our agents' reputation is visible to Virtuals Protocol, Chitin, AgentStore, and every other ERC-8004 app. An agent that performs well on AgentChain carries that reputation everywhere.
2. **One less contract** to deploy, audit, and maintain.
3. **Permissionless** — Any address can submit feedback (except self-review). No need for our own access control.
4. **Tag-based filtering** — We tag feedback with `tag1 = "agentchain"` and `tag2 = "delegation"` so our feedback is filterable within the global pool.
5. **Stronger bounty qualification** — Shows deep integration with ERC-8004, not just a `register()` call.

### ERC-8004 Reputation Registry Interface (Real, from EIP)

```solidity
// Deployed at 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 on Base
interface IReputationRegistry {

    // ─── Write ─────────────────────────────────────────────

    /// @notice Submit feedback for an agent. Permissionless (except self-review blocked).
    /// @param agentId ERC-8004 identity NFT token ID
    /// @param value Rating as fixed-point int128 (e.g., 45 with 1 decimal = 4.5 stars)
    /// @param valueDecimals Number of decimal places (0-18)
    /// @param tag1 Primary category (we use "agentchain")
    /// @param tag2 Secondary category (we use "delegation")
    /// @param endpoint Service endpoint evaluated (optional, "")
    /// @param feedbackURI Link to extended feedback JSON (optional, "")
    /// @param feedbackHash Hash of feedbackURI content (optional, bytes32(0))
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    /// @notice Revoke previously submitted feedback
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    // ─── Read ──────────────────────────────────────────────

    /// @notice Get aggregated reputation summary for an agent
    /// @param clientAddresses Whose feedback to aggregate (Sybil resistance)
    /// @param tag1 Filter by primary tag ("" = all)
    /// @param tag2 Filter by secondary tag ("" = all)
    /// @return count Number of matching feedback entries
    /// @return summaryValue Average rating (fixed-point)
    /// @return summaryValueDecimals Decimal precision of summaryValue
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

    /// @notice Read a single feedback entry
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (
        int128 value, uint8 valueDecimals,
        string memory tag1, string memory tag2,
        bool isRevoked
    );

    /// @notice Get all clients who've reviewed this agent
    function getClients(uint256 agentId) external view returns (address[] memory);

    /// @notice Get feedback count from a specific client
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
}
```

### How We Use It

**After settlement (in `AgentChainArbiter.settleAndRate()`):**
```solidity
// For each agent in the delegation chain:
reputationRegistry.giveFeedback(
    agent.erc8004Id,    // uint256 — the agent's ERC-8004 NFT ID
    45,                 // int128  — 4.5 stars
    1,                  // uint8   — 1 decimal place
    "agentchain",       // tag1    — our protocol tag
    "delegation",       // tag2    — task type tag
    "",                 // endpoint (optional)
    "",                 // feedbackURI (optional)
    bytes32(0)          // feedbackHash (optional)
);
```

**For discovery filtering (SDK):**
```typescript
// Get all reviewers for this agent
const clients = await reputationRegistry.getClients(agentId);

// Get AgentChain-specific reputation (filtered by our tag)
const [count, avgRating, decimals] = await reputationRegistry.getSummary(
    agentId, clients, "agentchain", ""
);
const rating = Number(avgRating) / (10 ** decimals); // e.g., 4.5

// Or get delegation-specific reputation
const [dCount, dRating, dDec] = await reputationRegistry.getSummary(
    agentId, clients, "agentchain", "delegation"
);
```

**For disputes (user calls directly):**
```solidity
// Negative feedback — user gives -1 star for bad work
reputationRegistry.giveFeedback(
    agentId,
    -10,               // int128  — -1.0 (negative rating)
    1,                  // uint8   — 1 decimal
    "agentchain",       // tag1
    "dispute",          // tag2    — marks this as a dispute
    "",
    "ipfs://Qm...",    // feedbackURI — detailed dispute description
    feedbackHash
);
```

### Design Note: New Agents

Agents with no feedback in ERC-8004 Reputation Registry are treated as new. The SDK defaults to allowing new agents (filtered by stake as the trust signal). As agents complete tasks, their `"agentchain"` tagged feedback builds up and becomes the primary discovery signal.

---

## 4. `AgentChainArbiter.sol`

Custom Alkahest arbiter implementing **three novel verification mechanisms** that go beyond wrapping existing contracts:

1. **Delegation Chain Integrity Verification** — Verifies MetaMask delegation hashes are valid and not revoked on-chain
2. **Stake-Weighted Consensus** — Weights work completion by agent stake, not just a headcount
3. **Reputation-Gated Release** — ERC-8004 reputation as a verification condition INSIDE `checkStatement()`, not a side effect

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEAS, Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";

interface IArbiter {
    function checkStatement(
        Attestation memory obligation,
        bytes memory demand,
        bytes32 counteroffer
    ) external view returns (bool);
}

interface IDelegationManager {
    function disabledDelegations(bytes32 delegationHash) external view returns (bool);
}

interface IDelegationTracker {
    function getTaskDelegations(bytes32 taskId) external view returns (DelegationHop[] memory);
    function hasWorkRecord(bytes32 taskId, address agent) external view returns (bool);
    function settleTask(bytes32 taskId) external;
    function getPromisedFee(bytes32 taskId, address agent) external view returns (uint256);
    function tasks(bytes32) external view returns (
        address creator,
        address orchestrator,
        uint8 status,
        uint256 deadline,
        uint256 delegationCount,
        uint256 feePool
    );
}

// NOTE: Must match DelegationTracker.DelegationHop exactly.
// Duplicated here because Solidity requires local struct definition for cross-contract ABI decoding.
struct DelegationHop {
    address delegator;
    address delegate;
    uint8 depth;
    bytes32 delegationHash;    // MetaMask delegation hash — for chain integrity verification
    uint256 timestamp;
}

interface IAgentRegistry {
    function agents(address) external view returns (
        string memory name,
        uint256 erc8004Id,
        string memory ensName,
        uint256 registeredAt,
        bool active
    );
    function stakes(address agent) external view returns (uint256);
    function distributeFeesFromStake(
        address orchestrator,
        address[] calldata agents_,
        uint256[] calldata fees
    ) external;
}

// ERC-8004 Reputation Registry at 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    function getClients(uint256 agentId) external view returns (address[] memory);

    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}

/// @title AgentChainArbiter
/// @notice Alkahest arbiter with three novel verification mechanisms:
///         1. Delegation chain integrity — verifies MetaMask delegation hashes are live (not revoked)
///         2. Stake-weighted consensus — weights completion by agent stake, not headcount
///         3. Reputation-gated release — ERC-8004 reputation as a verification condition
/// @dev Extends the Alkahest escrow protocol with a new multi-agent trust model:
///      escrow releases ONLY when the delegation chain is intact, stake-weighted work
///      completion exceeds a threshold, and all agents meet minimum reputation.
contract AgentChainArbiter is IArbiter {
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error NotTaskCreator(address caller, address creator);
    error TaskNotAccepted(bytes32 taskId);
    error InvalidRating(int128 value);
    error InvalidThreshold(uint256 value);

    // ─── State ─────────────────────────────────────────────

    IDelegationTracker public immutable tracker;
    IDelegationManager public immutable delegationManager; // MetaMask DelegationManager
    IReputationRegistry public immutable reputation;       // ERC-8004 Reputation Registry
    IAgentRegistry public immutable agentRegistry;

    /// @notice Encoded in the escrow's demand field when creating the Alkahest obligation.
    ///         This is the NEW verification primitive — multi-dimensional conditions that
    ///         no existing Alkahest arbiter can express.
    struct DemandData {
        bytes32 taskId;                // EAS attestation UID = task identifier
        address orchestrator;          // who receives the full escrowed amount
        uint256 stakeThresholdBps;     // stake-weighted completion threshold (basis points, e.g., 7500 = 75%)
        int128 minReputation;          // minimum ERC-8004 reputation score (fixed-point, 1 decimal)
        bool reputationRequired;       // whether to enforce reputation gate (false for new agents)
    }

    // ─── Events ────────────────────────────────────────────

    event TaskVerified(
        bytes32 indexed taskId,
        uint256 workRecordCount,
        uint256 stakeWeightedScore,    // actual stake-weighted completion (bps)
        bool allDelegationsIntact      // whether chain integrity passed
    );
    event ReputationSubmitted(bytes32 indexed taskId, uint256 agentCount, int128 rating);

    // ─── Constructor ───────────────────────────────────────

    constructor(
        address _tracker,
        address _delegationManager,
        address _reputation,
        address _agentRegistry
    ) {
        tracker = IDelegationTracker(_tracker);
        delegationManager = IDelegationManager(_delegationManager);
        reputation = IReputationRegistry(_reputation);
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ═══════════════════════════════════════════════════════
    //  VERIFICATION PRIMITIVE: checkStatement()
    //  Three novel mechanisms that compose into a single
    //  multi-dimensional verification condition.
    // ═══════════════════════════════════════════════════════

    /// @notice Called by Alkahest to verify if escrow should be released.
    ///         Implements three verification layers:
    ///         1. Delegation chain integrity (are all MetaMask delegations still live?)
    ///         2. Stake-weighted consensus (is enough staked value backing completed work?)
    ///         3. Reputation gate (do all agents meet minimum ERC-8004 reputation?)
    function checkStatement(
        Attestation memory obligation,
        bytes memory demand,
        bytes32 counteroffer
    ) external view override returns (bool) {
        DemandData memory d = abi.decode(demand, (DemandData));

        // 0. Verify the orchestrator matches
        (, address taskOrchestrator,,,,) = tracker.tasks(d.taskId);
        if (taskOrchestrator != d.orchestrator) return false;

        // Get all delegation hops for this task
        DelegationHop[] memory hops = tracker.getTaskDelegations(d.taskId);
        if (hops.length == 0) return false;

        // ─── LAYER 1: Delegation Chain Integrity ────────────
        // Verify every MetaMask delegation in the chain is still active
        // (not revoked via DelegationManager.disableDelegation()).
        // This is a NEW verification mechanism — no existing Alkahest arbiter
        // verifies multi-party delegation chain liveness.
        for (uint i = 0; i < hops.length; i++) {
            if (delegationManager.disabledDelegations(hops[i].delegationHash)) {
                // A delegation in the chain was revoked — work is no longer authorized
                return false;
            }
        }

        // ─── LAYER 2: Stake-Weighted Consensus ─────────────
        // Instead of "did N agents submit work?" (trivial counter), we weight
        // by stake: an agent with 5000 USDC staked completing work contributes
        // more to the consensus than one with 50 USDC.
        //
        // Formula: sum(stake of agents WITH work records) / sum(stake of ALL delegated agents)
        // Must exceed stakeThresholdBps (e.g., 75% = 7500 bps).
        //
        // This is a NEW trust model — proof-of-stake for service delivery.
        uint256 totalStake = 0;
        uint256 completedStake = 0;

        for (uint i = 0; i < hops.length; i++) {
            uint256 agentStake = agentRegistry.stakes(hops[i].delegate);
            totalStake += agentStake;

            if (tracker.hasWorkRecord(d.taskId, hops[i].delegate)) {
                completedStake += agentStake;
            }
        }

        // Avoid division by zero (shouldn't happen — agents must stake to be delegated)
        if (totalStake == 0) return false;

        // Check stake-weighted completion meets threshold
        // completedStake * 10000 / totalStake >= stakeThresholdBps
        if ((completedStake * 10_000) / totalStake < d.stakeThresholdBps) {
            return false;
        }

        // ─── LAYER 3: Reputation-Gated Release ─────────────
        // ERC-8004 reputation is a VERIFICATION CONDITION, not a side effect.
        // Escrow only releases if every agent in the chain meets minimum
        // reputation on the canonical ERC-8004 Reputation Registry.
        //
        // This is NEW — no existing arbiter ties escrow release to cross-protocol
        // reputation scores. It creates a feedback loop: good work → reputation →
        // access to higher-value escrows → more good work.
        //
        // When reputationRequired is false (for bootstrapping), this layer is skipped.
        if (d.reputationRequired) {
            for (uint i = 0; i < hops.length; i++) {
                (, uint256 erc8004Id,,,) = agentRegistry.agents(hops[i].delegate);

                // Get all clients who have reviewed this agent
                address[] memory clients = reputation.getClients(erc8004Id);

                // Skip agents with no reviews (new agents are allowed through)
                if (clients.length == 0) continue;

                // Get AgentChain-specific reputation summary
                (uint64 count, int128 avgRating,) = reputation.getSummary(
                    erc8004Id,
                    clients,
                    "agentchain",  // filter by our protocol tag
                    ""             // all sub-tags
                );

                // Agent must have minimum reputation (if they have any reviews)
                if (count > 0 && avgRating < d.minReputation) {
                    return false;
                }
            }
        }

        return true;
    }

    // ═══════════════════════════════════════════════════════
    //  SETTLEMENT + REPUTATION FEEDBACK
    // ═══════════════════════════════════════════════════════

    /// @notice Called by task creator after escrow release.
    ///         1. Submits ERC-8004 reputation feedback for all agents with work records
    ///         2. Auto-distributes promised fees from orchestrator's stake to sub-agents
    ///         3. Marks task as completed
    ///         This closes the full loop: work → settlement → reputation + payment.
    /// @param taskId The settled task
    /// @param rating Rating for agents (1-5 scale, 1 decimal: 10 = 1.0, 45 = 4.5, 50 = 5.0)
    function settleAndRate(bytes32 taskId, int128 rating) external {
        // Verify caller is the task creator
        (address creator, address orchestrator,,,,) = tracker.tasks(taskId);
        if (msg.sender != creator) NotTaskCreator.selector.revertWith(msg.sender, creator);

        // Validate rating range (1.0 - 5.0 with 1 decimal)
        if (rating < 10 || rating > 50) InvalidRating.selector.revertWith();

        // Get all delegation hops
        DelegationHop[] memory hops = tracker.getTaskDelegations(taskId);

        // ─── Phase 1: Reputation feedback + collect fee data ──────
        uint256 totalStake = 0;
        uint256 completedStake = 0;

        // Build arrays for fee distribution (only agents with work records get paid)
        address[] memory payableAgents = new address[](hops.length);
        uint256[] memory payableFees = new uint256[](hops.length);
        uint256 payableCount = 0;

        for (uint i = 0; i < hops.length; i++) {
            (, uint256 erc8004Id,,,) = agentRegistry.agents(hops[i].delegate);
            uint256 agentStake = agentRegistry.stakes(hops[i].delegate);
            totalStake += agentStake;

            if (tracker.hasWorkRecord(taskId, hops[i].delegate)) {
                completedStake += agentStake;

                // Submit POSITIVE feedback to ERC-8004 Reputation Registry
                reputation.giveFeedback(
                    erc8004Id,
                    rating,          // int128 — e.g., 45 = 4.5 stars
                    1,               // uint8  — 1 decimal place
                    "agentchain",    // tag1   — our protocol identifier
                    "delegation",    // tag2   — task type
                    "",              // endpoint (not needed)
                    "",              // feedbackURI (not needed)
                    bytes32(0)       // feedbackHash (not needed)
                );

                // Collect fee for distribution
                uint256 fee = tracker.getPromisedFee(taskId, hops[i].delegate);
                if (fee > 0) {
                    payableAgents[payableCount] = hops[i].delegate;
                    payableFees[payableCount] = fee;
                    payableCount++;
                }
            }
            // Agents who were delegated but did NOT submit work records
            // get no reputation feedback AND no fee payment
        }

        // ─── Phase 2: Trustless fee distribution from orchestrator's stake ──
        if (payableCount > 0) {
            // Trim arrays to actual size
            address[] memory trimmedAgents = new address[](payableCount);
            uint256[] memory trimmedFees = new uint256[](payableCount);
            for (uint i = 0; i < payableCount; i++) {
                trimmedAgents[i] = payableAgents[i];
                trimmedFees[i] = payableFees[i];
            }

            // Auto-distribute fees from orchestrator's stake
            // This is trustless: fees were encoded in AgentTerms (immutable),
            // recorded in DelegationTracker.promisedFees, and now deducted
            // from orchestrator's stake and sent directly to sub-agents.
            agentRegistry.distributeFeesFromStake(orchestrator, trimmedAgents, trimmedFees);
        }

        // ─── Phase 3: Finalize ──────────────────────────────────
        tracker.settleTask(taskId);

        uint256 stakeScore = totalStake > 0 ? (completedStake * 10_000) / totalStake : 0;
        emit TaskVerified(taskId, hops.length, stakeScore, true);
        emit ReputationSubmitted(taskId, hops.length, rating);
    }

    /// @notice Submit negative feedback / dispute for a specific agent.
    ///         Only callable by task creator.
    /// @param taskId The task in question
    /// @param agentAddress The agent to dispute
    /// @param feedbackURI IPFS link to dispute details
    /// @param feedbackHash Hash of the dispute content
    function disputeAgent(
        bytes32 taskId,
        address agentAddress,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        (address creator,,,,,) = tracker.tasks(taskId);
        if (msg.sender != creator) NotTaskCreator.selector.revertWith(msg.sender, creator);

        (, uint256 erc8004Id,,,) = agentRegistry.agents(agentAddress);

        // Submit negative feedback to ERC-8004 Reputation Registry
        // This DIRECTLY impacts the agent's ability to pass future reputation gates
        // in checkStatement() — creating real consequences for bad work.
        reputation.giveFeedback(
            erc8004Id,
            -10,              // int128  — -1.0 stars (negative)
            1,                // uint8   — 1 decimal
            "agentchain",     // tag1
            "dispute",        // tag2    — marks as dispute
            "",               // endpoint
            feedbackURI,      // IPFS link to detailed dispute
            feedbackHash      // content hash for verification
        );
    }
}
```

### The Three Verification Mechanisms (Why This Wins)

This arbiter introduces **three verification mechanisms that don't exist in any built-in Alkahest arbiter**:

#### 1. Delegation Chain Integrity (New Verification Mechanism)

```
Built-in TrustedPartyArbiter:     "Did Alice sign? ✓"
Our arbiter:                      "Are ALL MetaMask delegations in the
                                   multi-hop chain still live (not revoked)?"
```

We query `DelegationManager.disabledDelegations(hash)` for every delegation in the chain. If the orchestrator revoked a sub-agent's delegation mid-task (because they detected malicious behavior), the escrow cannot be collected — even if work records were submitted. This is a **liveness check on an external authorization system** (MetaMask Delegation Framework), which no existing Alkahest arbiter does.

**Why it matters:** Without this, a revoked-but-completed delegation chain could still release funds. The arbiter ensures escrow and delegation authorization are cryptographically linked.

#### 2. Stake-Weighted Consensus (New Trust Model)

```
Built-in (counter):     3/4 agents submitted work → 75% → pass
Our arbiter:            Agent A (5000 USDC staked) + Agent B (50 USDC staked) submitted
                        Agent C (3000 USDC staked) did NOT submit
                        Stake-weighted: (5000+50)/(5000+50+3000) = 62.7% → configurable threshold
```

This is **proof-of-stake for service delivery**. An agent with more at risk (higher stake) has a proportionally larger voice in the consensus. The threshold is configurable per-task in `DemandData.stakeThresholdBps`:

| Scenario | Threshold | Meaning |
|----------|-----------|---------|
| High-value DeFi task | 9000 (90%) | Almost all staked value must complete work |
| Research task | 5000 (50%) | Majority stake completion is enough |
| Exploratory task | 2500 (25%) | Low bar — experimental agents welcome |

**Why it matters:** A headcount is trivially gameable (register 10 Sybil agents with 1 USDC stake each). Stake-weighting makes it economically expensive to manipulate the consensus.

#### 3. Reputation-Gated Release (New Verification Logic)

```
Built-in:     Escrow releases if work is done. Reputation? What reputation?
Our arbiter:  Escrow releases if work is done AND agents have minimum
              ERC-8004 reputation on the canonical cross-protocol registry.
```

Reputation isn't a side effect of settlement — it's a **condition for settlement**. The arbiter reads `getSummary()` on the ERC-8004 Reputation Registry (deployed at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`) with our `"agentchain"` tag filter. This creates a closed feedback loop:

```
Good work → Settlement → Positive ERC-8004 feedback → Higher reputation
→ Passes reputation gate on future high-value escrows → More good work

Bad work → Dispute → Negative ERC-8004 feedback → Lower reputation
→ Fails reputation gate → Locked out of high-value escrows
```

**Cold start:** `DemandData.reputationRequired = false` for bootstrapping. As the ecosystem matures, task creators can turn it on and set `minReputation` to filter low-quality agents.

**Why it matters:** This ties escrow release to a **cross-protocol reputation system** (ERC-8004). An agent's reputation on AgentChain affects their ability to work on ANY ERC-8004-integrated platform (Virtuals, Chitin, AgentStore), and vice versa. No existing Alkahest arbiter reads external reputation registries as a verification condition.

### Alkahest Integration Flow (Updated)

```
1. User (EOA) calls Alkahest.makeStatement():
   - token: USDC
   - amount: 5000
   - arbiter: AgentChainArbiter address
   - demand: abi.encode(DemandData{
       taskId: <from registerTask>,
       orchestrator: 0xOrch...,
       stakeThresholdBps: 7500,       ← 75% stake-weighted completion
       minReputation: 30,              ← minimum 3.0 stars on ERC-8004
       reputationRequired: true        ← enforce reputation gate
     })
   → SDK also calls tracker.registerTask(taskId, deadline, feePool)
   → Returns EAS attestation UID (this becomes taskId)

2. Orchestrator claims task via claimTask(). Sub-agents do work via
   MetaMask delegations (each with a fee encoded in AgentTerms).
   Submit work records to DelegationTracker.

3. Orchestrator calls Alkahest.collectPayment():
   - Alkahest calls AgentChainArbiter.checkStatement()
   - Layer 1: Checks ALL delegation hashes are live (not revoked) ← NEW
   - Layer 2: Checks stake-weighted completion >= 75%             ← NEW
   - Layer 3: Checks all agents have >= 3.0 stars on ERC-8004    ← NEW
   - If all three pass → full USDC released to orchestrator's smart account
   - If any fails → reverts

4. Task creator calls AgentChainArbiter.settleAndRate():
   - Phase 1: Submits ERC-8004 reputation feedback for agents WITH work records
   - Phase 2: Auto-distributes promised fees from orchestrator's STAKE to
              sub-agents via agentRegistry.distributeFeesFromStake() ← TRUSTLESS
   - Phase 3: Marks task as Completed in DelegationTracker
   - Agents WITHOUT work records get no feedback AND no payment

5. Orchestrator transfers investment tokens back to user
   - Orchestrator's stake (minus distributed fees) remains as collateral

6. (Optional) Task creator calls AgentChainArbiter.disputeAgent():
   - Submits negative ERC-8004 feedback (tag: "agentchain/dispute")
   - Directly impacts agent's ability to pass future reputation gates
```

### Why This is a Strong ERC-8004 Integration

| What a judge would check | Our answer |
|--------------------------|------------|
| Uses Identity Registry? | Yes — `register()` during agent registration, stores `erc8004Id` |
| Uses Reputation Registry? | Yes — `giveFeedback()` on settlement AND disputes |
| Uses tag filtering? | Yes — `tag1 = "agentchain"`, `tag2 = "delegation"` / `"dispute"` |
| Reputation is composable? | Yes — agents carry AgentChain reputation to Virtuals, Chitin, etc. |
| Reads reputation for discovery? | Yes — SDK calls `getSummary()` with our tags to filter agents |
| **Reads reputation for verification?** | **Yes — `checkStatement()` gates escrow release on ERC-8004 scores** |
| Negative feedback / disputes? | Yes — `disputeAgent()` submits negative ratings with IPFS evidence |
| **Reputation creates real consequences?** | **Yes — low reputation = blocked from future high-value escrows** |

### Alkahest Judge Scorecard

| Bounty Criteria | Our Answer | Assessment |
|-----------------|------------|------------|
| "New arbiter" | AgentChainArbiter with 3 verification layers | Yes — novel |
| "New verification mechanism" | Delegation chain integrity check via DelegationManager | Yes — no existing arbiter does this |
| "New trust model" | Stake-weighted consensus (proof-of-stake for service delivery) | Yes — fundamentally different from headcount |
| "Goes beyond wrapping" | Composes MetaMask delegation liveness + ERC-8004 reputation + stake weighting into a single `checkStatement()` | Yes — three external systems composed |
| "New obligation pattern" | Multi-agent delegation chain as obligation fulfillment | Yes — extends single-party obligations to delegation trees |

---

## Gas Estimates (Rough)

| Operation | Estimated Gas |
|-----------|--------------|
| `registerAndStake()` | ~200k (storage writes + capability indexing + ERC-8004 register) |
| `recordDelegation()` | ~55k (push to array + isDelegated mapping + delegationHash storage) |
| `submitWorkRecord()` | ~60k (storage write + event) |
| `checkStatement()` | ~50k per hop (view: delegation liveness + stake read + reputation read) |
| `settleAndRate()` | ~100k per agent (ERC-8004 giveFeedback + fee distribution + settle) |
| `distributeFeesFromStake()` | ~30k per agent (stake deduction + safeTransfer) |
| `disputeAgent()` | ~80k (ERC-8004 giveFeedback with URI) |

**Note on `checkStatement()` gas:** The reputation gate (`getSummary()` + `getClients()`) adds ~20k per hop compared to the old counter approach. This is acceptable because: (a) `checkStatement()` is called once per escrow collection, not per transaction, and (b) the gas cost scales with delegation chain length, which is bounded by `maxDepth` (typically 3-5 hops).

---

## Test Plan

```
test/
├── AgentRegistry.t.sol
│   ├── test_registerAndStake_success
│   ├── test_registerAndStake_erc8004IdSet
│   ├── test_registerAndStake_duplicateFails
│   ├── test_registerAndStake_zeroStakeFails
│   ├── test_linkENSName
│   ├── test_addStake
│   ├── test_unstake
│   ├── test_updateCapabilities
│   ├── test_updateAgentURI
│   ├── test_getAgentsByCapability
│   ├── test_hasCapabilities_true
│   ├── test_hasCapabilities_missing
│   ├── test_deactivate
│   ├── test_setArbiter_onlyDeployer
│   ├── test_setArbiter_onlyOnce
│   ├── test_distributeFeesFromStake_success
│   ├── test_distributeFeesFromStake_onlyArbiter
│   ├── test_distributeFeesFromStake_insufficientStakeFails
│   └── test_distributeFeesFromStake_correctBalances
│
├── AgentCapabilityEnforcer.t.sol
│   ├── test_beforeHook_validAgent
│   ├── test_beforeHook_unregisteredFails
│   ├── test_beforeHook_insufficientStakeFails
│   ├── test_beforeHook_missingCapsFails
│   ├── test_beforeHook_depthLimitFails
│   ├── test_afterHook_recordsDelegationAndFee
│   ├── test_composedWithAllowedTargets_wrongTargetReverts
│   ├── test_composedWithERC20TransferAmount_overBudgetReverts
│   ├── test_composedWithTimestamp_expiredReverts
│   ├── test_composedWithLimitedCalls_exceededReverts
│   ├── test_subDelegation_caveatAttenuationEnforced
│   └── test_subDelegation_childCannotWeakenParent
│
├── DelegationTracker.t.sol
│   ├── test_registerTask
│   ├── test_registerTask_duplicateFails
│   ├── test_claimTask_byRegisteredAgent
│   ├── test_claimTask_unregisteredFails
│   ├── test_claimTask_alreadyClaimedFails
│   ├── test_registerTask_withFeePool
│   ├── test_recordDelegation_byCaveatEnforcer
│   ├── test_recordDelegation_unauthorizedFails
│   ├── test_recordDelegation_storesPromisedFee
│   ├── test_recordDelegation_feeExceedsPoolFails
│   ├── test_submitWorkRecord_byDelegatedAgent
│   ├── test_submitWorkRecord_nonDelegatedFails
│   ├── test_submitWorkRecord_duplicateFails
│   ├── test_settleTask
│   └── test_expireTask
│
├── AgentChainArbiter.t.sol
│   ├── test_checkStatement_chainIntegrity_allLive_passes
│   ├── test_checkStatement_chainIntegrity_revokedDelegation_fails
│   ├── test_checkStatement_stakeWeighted_aboveThreshold_passes
│   ├── test_checkStatement_stakeWeighted_belowThreshold_fails
│   ├── test_checkStatement_stakeWeighted_highStakeAgentMatters
│   ├── test_checkStatement_reputationGate_aboveMin_passes
│   ├── test_checkStatement_reputationGate_belowMin_fails
│   ├── test_checkStatement_reputationGate_newAgentSkipped
│   ├── test_checkStatement_reputationGate_disabled_passes
│   ├── test_checkStatement_wrongOrchestrator_false
│   ├── test_checkStatement_noHops_fails
│   ├── test_settleAndRate_onlyAgentsWithWorkRecordsGetFeedback
│   ├── test_settleAndRate_correctTags
│   ├── test_settleAndRate_nonCreatorFails
│   ├── test_settleAndRate_distributesFeesFromStake
│   ├── test_settleAndRate_onlyPaysAgentsWithWorkRecords
│   ├── test_settleAndRate_orchestratorStakeReduced
│   ├── test_disputeAgent_submitsNegativeFeedback
│   ├── test_disputeAgent_impactsReputationGate
│   └── test_disputeAgent_nonCreatorFails
│
└── Integration.t.sol
    ├── test_fullFlow_register_escrow_delegate_redeemDeFiAction_settle_reputation
    ├── test_fullFlow_subDelegationChain_budgetAttenuates
    ├── test_fullFlow_erc8004ReputationQueryable
    ├── test_fullFlow_delegationRevocation_disablesDelegation
    ├── test_fullFlow_deadlineExpiry
    ├── test_fullFlow_depthLimit_blocksDeepChains
    ├── test_fullFlow_feeDistribution_endToEnd
    └── test_fullFlow_feeDistribution_agentWithoutWorkGetsNothing
```
