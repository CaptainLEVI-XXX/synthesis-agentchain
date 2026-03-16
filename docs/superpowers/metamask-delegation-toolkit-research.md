# MetaMask Delegation Toolkit (Smart Accounts Kit) -- Deep Technical Research

> Research Date: 2026-03-15
> Sources: GitHub `MetaMask/delegation-framework`, MetaMask developer docs, on-chain contract source code
> Framework version: v1.3.0 (Solidity contracts), SDK: `@metamask/smart-accounts-kit`

---

## 1. ICaveatEnforcer Interface -- Exact Signatures

Source: `src/interfaces/ICaveatEnforcer.sol`

```solidity
// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "../utils/Types.sol";

interface ICaveatEnforcer {
    function beforeAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    function afterHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    function afterAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;
}
```

### Parameter Semantics

| Parameter | Type | Description |
|-----------|------|-------------|
| `_terms` | `bytes` | Immutable conditions set by the delegator at delegation creation time. Encoded per-enforcer (e.g., token address + max amount for ERC20TransferAmountEnforcer). |
| `_args` | `bytes` | Mutable arguments provided by the redeemer at redemption time. Can carry dynamic data like group index for LogicalOrWrapperEnforcer. |
| `_mode` | `ModeCode` | ERC-7579 execution mode encoding call type + exec type. |
| `_executionCalldata` | `bytes` | The encoded Execution(s) being performed (target, value, callData). |
| `_delegationHash` | `bytes32` | Hash of the delegation being redeemed. Used as key for stateful tracking (e.g., spending maps). |
| `_delegator` | `address` | The account granting permission (the root smart account). |
| `_redeemer` | `address` | The account redeeming the delegation. |

### ModeCode

`ModeCode` is a `bytes32` type imported from ERC-7579 (`@erc7579/lib/ModeLib.sol`). It encodes:
- **CallType**: `CALLTYPE_SINGLE` or `CALLTYPE_BATCH`
- **ExecType**: `EXECTYPE_DEFAULT` (reverts on failure) or `EXECTYPE_TRY` (continues on failure)
- **ModeSelector** and **ModePayload** (reserved for future use)

Four practical modes used by the SDK:

| Mode | CallType | ExecType | Behavior |
|------|----------|----------|----------|
| `SingleDefault` | Single | Default | One execution, revert on failure |
| `SingleTry` | Single | Try | One execution, continue on failure |
| `BatchDefault` | Batch | Default | Multiple executions, revert on failure |
| `BatchTry` | Batch | Try | Multiple executions, continue on failure |

### Hook Execution Order

For **Sequential** (Single mode): `beforeAllHook` -> `beforeHook` -> execution -> `afterHook` -> `afterAllHook`

For **Interleaved** (Batch mode): all `beforeAllHook`s -> all `beforeHook`s -> all executions -> all `afterHook`s -> all `afterAllHook`s

### CaveatEnforcer Abstract Base Contract

Source: `src/enforcers/CaveatEnforcer.sol`

Provides empty virtual implementations of all 4 hooks (so you only override what you need) plus modifiers:
- `onlySingleCallTypeMode(_mode)` -- reverts if mode is not single call type
- `onlyBatchCallTypeMode(_mode)` -- reverts if mode is not batch call type
- `onlyDefaultExecutionMode(_mode)` -- reverts if exec type is not default
- `onlyTryExecutionMode(_mode)` -- reverts if exec type is not try

---

## 2. Built-in Caveat Enforcers (All 37)

Source: `src/enforcers/` directory in `MetaMask/delegation-framework`

### Target/Caller/Method Restrictions

| # | Enforcer | Description |
|---|----------|-------------|
| 1 | **AllowedTargetsEnforcer** | Restricts which contract addresses can be called. Terms: concatenated 20-byte addresses. |
| 2 | **AllowedMethodsEnforcer** | Restricts which function selectors can be called. Terms: concatenated 4-byte selectors. |
| 3 | **AllowedCalldataEnforcer** | Validates specific bytes within calldata match expected values. Terms: 32-byte offset + expected value bytes. |
| 4 | **RedeemerEnforcer** | Restricts which addresses can redeem the delegation. Terms: concatenated 20-byte redeemer addresses. |

### Exact Execution Matching

| # | Enforcer | Description |
|---|----------|-------------|
| 5 | **ExactCalldataEnforcer** | Requires the entire calldata to exactly match a predetermined value. |
| 6 | **ExactCalldataBatchEnforcer** | Batch version of ExactCalldataEnforcer. |
| 7 | **ExactExecutionEnforcer** | Requires the full Execution (target + value + calldata) to match exactly. |
| 8 | **ExactExecutionBatchEnforcer** | Batch version of ExactExecutionEnforcer. |

### Native Token (ETH) Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 9 | **ValueLteEnforcer** | Limits the `msg.value` of a single execution. Terms: `abi.encode(uint256 maxValue)`. |
| 10 | **NativeTokenTransferAmountEnforcer** | Tracks cumulative native token spending per delegation with a max allowance. Uses `spentMap[sender][delegationHash]`. Terms: `abi.encode(uint256 allowance)`. |
| 11 | **NativeBalanceChangeEnforcer** | Validates a recipient's native balance changed by at most/at least a specified amount (before/after hook pattern). Terms: 53 bytes (bool direction + address recipient + uint256 amount). |
| 12 | **NativeTokenPaymentEnforcer** | Enforces a native token payment as a condition for delegation redemption. |
| 13 | **NativeTokenPeriodTransferEnforcer** | Periodic (time-windowed) native token transfer limits. Resets each period. |
| 14 | **NativeTokenStreamingEnforcer** | Streaming/linear-unlock pattern for native token allowances over time. |
| 15 | **NativeTokenMultiOperationIncreaseBalanceEnforcer** | Validates native balance increases across multiple operations. |

### ERC-20 Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 16 | **ERC20TransferAmountEnforcer** | Tracks cumulative ERC-20 `transfer()` spending. Terms: 52 bytes = `address token (20 bytes) + uint256 maxAmount (32 bytes)`. Uses `spentMap[sender][delegationHash]`. |
| 17 | **ERC20BalanceChangeEnforcer** | Before/after pattern: snapshots ERC-20 balance, then validates change direction and amount. Terms: bool direction + address token + address recipient + uint256 amount. |
| 18 | **ERC20PeriodTransferEnforcer** | Time-windowed ERC-20 transfer limits. Terms: 116 bytes = token address + periodAmount + periodDuration + startDate. Resets allowance each period. |
| 19 | **ERC20StreamingEnforcer** | Linear-unlock streaming for ERC-20 token allowances. |
| 20 | **ERC20MultiOperationIncreaseBalanceEnforcer** | Validates ERC-20 balance increases across multiple operations. |
| 21 | **SpecificActionERC20TransferBatchEnforcer** | Batch-specific ERC-20 transfer enforcement with predefined actions. |

### ERC-721 (NFT) Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 22 | **ERC721TransferEnforcer** | Restricts which ERC-721 tokens can be transferred. |
| 23 | **ERC721BalanceChangeEnforcer** | Before/after pattern for NFT balance change validation. |
| 24 | **ERC721MultiOperationIncreaseBalanceEnforcer** | Validates NFT balance increases across multiple operations. |

### ERC-1155 Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 25 | **ERC1155BalanceChangeEnforcer** | Before/after pattern for ERC-1155 balance validation. |
| 26 | **ERC1155MultiOperationIncreaseBalanceEnforcer** | Validates ERC-1155 balance increases across multiple operations. |

### Time & Frequency Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 27 | **TimestampEnforcer** | Time-window restriction. Terms: 32 bytes = `uint128 timestampAfterThreshold + uint128 timestampBeforeThreshold`. Zero disables that bound. Non-inclusive boundaries. |
| 28 | **BlockNumberEnforcer** | Block-number-based time window (analogous to TimestampEnforcer but uses block numbers). |
| 29 | **LimitedCallsEnforcer** | Limits total redemption count. Terms: `uint256 maxCalls` (32 bytes). Uses `callCounts[sender][delegationHash]`. |
| 30 | **NonceEnforcer** | Nonce-based single-use or ordered-use enforcement. |

### Composition & Logic Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 31 | **LogicalOrWrapperEnforcer** | Groups caveats into OR-groups. Each group has AND-semantics internally; redeemer selects which group to satisfy via `_args`. Warning: redeemer can pick the least restrictive group. |
| 32 | **ArgsEqualityCheckEnforcer** | Validates that `_args` matches `_terms` exactly (useful for requiring specific redemption-time arguments). |

### Identity & Lifecycle Enforcers

| # | Enforcer | Description |
|---|----------|-------------|
| 33 | **IdEnforcer** | Assigns an identifier to a delegation for tracking/indexing purposes. |
| 34 | **DeployedEnforcer** | Validates that a contract is deployed at a specific address before allowing execution. |
| 35 | **OwnershipTransferEnforcer** | Manages ownership transfer conditions in delegations. |

### Multi-Token Period Enforcer

| # | Enforcer | Description |
|---|----------|-------------|
| 36 | **MultiTokenPeriodEnforcer** | Periodic transfer limits across multiple token types simultaneously. |

### Base Contract

| # | Enforcer | Description |
|---|----------|-------------|
| 37 | **CaveatEnforcer** | Abstract base contract. Not deployed independently. |

---

## 3. Core Data Structures

Source: `src/utils/Types.sol`

```solidity
struct Delegation {
    address delegate;      // Who receives the permission (address(0xa11) = ANY_DELEGATE / open delegation)
    address delegator;     // Who grants the permission (must be a smart account)
    bytes32 authority;     // Hash of parent delegation, or ROOT_AUTHORITY for root delegations
    Caveat[] caveats;      // Array of restrictions
    uint256 salt;          // Uniqueness nonce
    bytes signature;       // EIP-712 signature from delegator
}

struct Caveat {
    address enforcer;      // Address of the deployed CaveatEnforcer contract
    bytes terms;           // Immutable conditions set at creation time
    bytes args;            // Mutable arguments provided at redemption time
}

struct Execution {
    address target;        // Contract to call
    uint256 value;         // Native token value to send
    bytes callData;        // Function calldata
}
```

### ROOT_AUTHORITY

```solidity
bytes32 constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
```

When `authority == ROOT_AUTHORITY`, the delegation comes directly from the delegator's own authority (no parent delegation).

### ANY_DELEGATE

```solidity
address constant ANY_DELEGATE = address(0xa11);
```

When `delegate == address(0xa11)`, any account can redeem the delegation (open delegation).

---

## 4. DelegationManager Contract

Source: `src/DelegationManager.sol`

### EIP-712 Domain

```
name: "DelegationManager"
version: "1"
chainId: <deployment chain>
verifyingContract: <DelegationManager address>
```

### Key Functions

```solidity
interface IDelegationManager {
    // Store a delegation on-chain (alternative to off-chain signing)
    function enableDelegation(Delegation calldata _delegation) external;

    // Revoke a delegation
    function disableDelegation(Delegation calldata _delegation) external;

    // Check if a delegation is disabled
    function disabledDelegations(bytes32 _delegationHash) external view returns (bool);

    // Compute delegation hash
    function getDelegationHash(Delegation calldata _delegation) external pure returns (bytes32);

    // Execute delegated actions -- THE CORE FUNCTION
    function redeemDelegations(
        bytes[] calldata _permissionContexts,  // Encoded delegation chains
        ModeCode[] calldata _modes,            // Execution modes
        bytes[] calldata _executionCallDatas   // Encoded Execution arrays
    ) external;

    function getDomainHash() external view returns (bytes32);
    function pause() external;
    function unpause() external;
}
```

### Events

```solidity
event RedeemedDelegation(address indexed rootDelegator, address indexed redeemer, Delegation delegation);
event EnabledDelegation(bytes32 indexed delegationHash, address indexed delegator, address indexed delegate, Delegation delegation);
event DisabledDelegation(bytes32 indexed delegationHash, address indexed delegator, address indexed delegate, Delegation delegation);
```

### Redemption Flow (redeemDelegations)

1. Validate array lengths match (`_permissionContexts.length == _modes.length == _executionCallDatas.length`)
2. For each batch item, decode the permission context into a `Delegation[]` chain
3. **Validate the chain** (ordered leaf-to-root):
   - The last delegation's `authority` must equal `ROOT_AUTHORITY`
   - Each delegation[i]'s `delegator` must equal delegation[i+1]'s `delegate` (or delegate is `ANY_DELEGATE`)
   - Each delegation[i]'s `authority` must equal `getDelegationHash(delegation[i+1])`
4. **Verify signatures**: EOA delegators use ECDSA recovery; smart contract delegators use ERC-1271 `isValidSignature()`
5. **Check not disabled**: `disabledDelegations[hash]` must be false
6. **Execute hooks**: `beforeAllHook` -> `beforeHook` -> `executeFromExecutor` on root delegator -> `afterHook` -> `afterAllHook`
7. Emit `RedeemedDelegation` event

### Off-chain Signing Flow

1. Delegator creates a `Delegation` struct (without signature)
2. Delegator signs it using EIP-712 typed data signing
3. The signed delegation is passed to the delegate off-chain (stored in a database, IPFS, etc.)
4. Delegate calls `redeemDelegations()` with the signed delegation chain
5. DelegationManager verifies the signature on-chain during redemption

### On-chain Delegation (Alternative)

1. Delegator calls `enableDelegation(delegation)` -- stores the delegation on-chain
2. The signature field can be empty for on-chain delegations
3. Delegate redeems as normal

---

## 5. Sub-delegation Chains and Caveat Attenuation

### How Sub-delegation Works

```
Alice (Smart Account) --[Delegation D1]--> Bob --[Delegation D2]--> Carol
```

**Step 1: Alice creates root delegation D1 to Bob**
```
D1 = {
    delegate: Bob,
    delegator: Alice,
    authority: ROOT_AUTHORITY (0xfff...fff),
    caveats: [
        { enforcer: AllowedTargetsEnforcer, terms: <Uniswap address> },
        { enforcer: ERC20TransferAmountEnforcer, terms: <USDC, 1000e6> }
    ],
    salt: 1,
    signature: <Alice's EIP-712 signature>
}
```

**Step 2: Bob re-delegates to Carol with STRICTER caveats**
```
D2 = {
    delegate: Carol,
    delegator: Bob,
    authority: getDelegationHash(D1),   // <-- links to parent
    caveats: [
        { enforcer: ERC20TransferAmountEnforcer, terms: <USDC, 200e6> },  // stricter: 200 < 1000
        { enforcer: TimestampEnforcer, terms: <after: now, before: now+1day> }  // additional restriction
    ],
    salt: 1,
    signature: <Bob's signature>
}
```

**Step 3: Carol redeems**
```
redeemDelegations(
    permissionContexts: [encode([D2, D1])],  // leaf to root order
    modes: [SingleDefault],
    executionCallDatas: [encode(Execution)]
)
```

### How Attenuation Works

**All caveats in the entire chain are enforced.** When Carol redeems:
1. D2's caveats are checked (200 USDC limit + time window)
2. D1's caveats are checked (1000 USDC limit + Uniswap target only)

Both sets must pass. This means the child delegation is automatically attenuated -- it can only be MORE restrictive than the parent, never less. Even if Bob's D2 tried to set a 2000 USDC limit, Alice's D1 would still enforce the 1000 USDC cap.

**Key insight for your agent system**: Each sub-agent's delegation automatically inherits ALL restrictions from every ancestor in the chain. You can safely add caveats at each level -- they compound.

### Does Bob Need a Smart Account?

**For re-delegation (creating D2): Bob needs to be able to sign.** Bob can be:
- An EOA (signs with ECDSA private key)
- A smart account (signs via ERC-1271)

**For redeeming (Carol's case): Carol needs to call `redeemDelegations()`.** Carol can be:
- An EOA (sends a regular transaction to the DelegationManager)
- A smart account (sends a UserOperation via ERC-4337)

**The DELEGATOR (Alice) MUST be a smart account** because the DelegationManager calls `executeFromExecutor` on the delegator's smart account to execute the action.

---

## 6. Smart Account Integration & ERC-4337

### Architecture

```
                                    ERC-4337 Infrastructure
                                    ┌─────────────┐
User/Agent ──UserOp──> Bundler ───> │ EntryPoint   │
                                    │   v0.7       │
                                    └──────┬───────┘
                                           │ handleOps()
                                           v
                                    ┌─────────────────────┐
                                    │ DeleGator Smart Acct │  <-- delegator OR delegate
                                    │ (ERC-4337 Account)   │
                                    └──────┬───────────────┘
                                           │ calls
                                           v
                                    ┌─────────────────────┐
                                    │ DelegationManager    │
                                    │ .redeemDelegations() │
                                    └──────┬───────────────┘
                                           │ validates chain, runs hooks
                                           │ calls executeFromExecutor()
                                           v
                                    ┌─────────────────────┐
                                    │ Root Delegator       │
                                    │ Smart Account        │
                                    │ (executes action)    │
                                    └──────────────────────┘
```

### Smart Account Implementations

The framework provides three DeleGator implementations:

1. **HybridDeleGator** -- Supports multiple signature schemes (ECDSA, P256/WebAuthn). Most flexible.
2. **MultiSigDeleGator** -- Multi-signature account requiring M-of-N signers.
3. **EIP7702StatelessDeleGator** -- For EIP-7702 delegation (EOA upgrade to smart account without proxy).

All are deployed behind ERC-1967 UUPS proxies (except EIP-7702 variant) and created via `SimpleFactory`.

### What ERC-4337 Infrastructure is Needed

1. **EntryPoint v0.7** -- Standard ERC-4337 EntryPoint
2. **Bundler** -- Submits UserOperations (e.g., Pimlico, Alchemy, Stackup)
3. **Paymaster** (optional) -- For gas sponsorship
4. **SimpleFactory** -- MetaMask's factory for creating DeleGator accounts (`0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c`)

### Who Needs a Smart Account?

| Role | Smart Account Required? | Why |
|------|------------------------|-----|
| **Delegator (root)** | YES -- MUST be a DeleGator smart account | DelegationManager calls `executeFromExecutor()` on it |
| **Delegate (redeemer)** | NO -- can be EOA or smart account | Just needs to call `redeemDelegations()` on DelegationManager |
| **Sub-delegator (middle of chain)** | NO -- can be EOA | Just needs to sign the re-delegation |
| **For your agent system** | All agents should be smart accounts | Enables gas abstraction, programmable behavior, and the ability to be BOTH delegator and delegate |

---

## 7. Deployment Addresses (v1.3.0)

The framework uses deterministic deployment (CREATE2 with salt "GATOR"), so addresses are **identical across all supported chains**.

### Core Contracts (Same on All Chains Including Base)

| Contract | Address |
|----------|---------|
| **DelegationManager** | `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` |
| **SimpleFactory** | `0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c` |
| **MultiSigDeleGatorImpl** | `0x56a9EdB16a0105eb5a4C54f4C062e2868844f3A7` |
| **HybridDeleGatorImpl** | `0x48dBe696A4D990079e039489bA2053B36E8FFEC4` |
| **EIP7702StatelessDeleGatorImpl** | `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B` |

### Enforcer Contracts (Same on All Chains Including Base)

All 36 enforcers are deployed at deterministic addresses. Key ones:

| Enforcer | Address |
|----------|---------|
| AllowedTargetsEnforcer | Deterministic (check Deployments.md for exact address) |
| AllowedMethodsEnforcer | Deterministic (check Deployments.md for exact address) |
| ERC20TransferAmountEnforcer | Deterministic (check Deployments.md for exact address) |
| TimestampEnforcer | Deterministic (check Deployments.md for exact address) |
| LimitedCallsEnforcer | Deterministic (check Deployments.md for exact address) |

### DelegationMetaSwapAdapter (Chain-Specific)

| Chain | Address |
|-------|---------|
| Ethereum | `0xe41eB5A3F6e35f1A8C77113F372892D09820C3fD` |
| Optimism, Base, Arbitrum, Linea | `0x5e4b49156D23D890e7DC264c378a443C2d22A80E` |
| BSC, Polygon | `0x9c06653D3f1A331eAf4C3833F7235156e47305F1` |

### Supported Networks

Mainnets: Ethereum, Optimism, Base, Arbitrum, Linea, BSC, Polygon (and more)
Testnets: Sepolia and testnet equivalents

**Base IS supported with all contracts deployed.**

---

## 8. NPM Packages

### TypeScript/JavaScript SDK

```bash
# Current package name (renamed from @metamask/delegation-toolkit)
npm install @metamask/smart-accounts-kit
```

Previous name (deprecated/redirect): `@metamask/delegation-toolkit`

The package `@codefi/delegator-core-viem` appears to be an older/internal Consensys package -- use `@metamask/smart-accounts-kit` instead.

### Solidity Contracts (via Forge)

```bash
forge install metamask/delegation-framework@v1.3.0
```

Add to `remappings.txt`:
```
@metamask/delegation-framework/=lib/metamask/delegation-framework/
```

### Key SDK Exports

```typescript
import {
    createDelegation,
    createExecution,
    ExecutionMode,
    createCaveatBuilder,
} from "@metamask/smart-accounts-kit"

import {
    DelegationManager,
} from "@metamask/smart-accounts-kit/contracts"
```

### Dependencies

- `viem` (core Ethereum library)
- `viem/account-abstraction` (bundler client, UserOperation types)

---

## 9. Building a Custom Caveat Enforcer

### Minimal Example: Budget Limit Enforcer

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { CaveatEnforcer } from "@metamask/delegation-framework/src/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "@metamask/delegation-framework/src/utils/Types.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

contract BudgetLimitEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    mapping(address sender => mapping(bytes32 delegationHash => uint256 spent)) public spentMap;

    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address,
        address _redeemer
    )
        public
        override
        onlySingleCallTypeMode(_mode)
        onlyDefaultExecutionMode(_mode)
    {
        uint256 maxBudget = abi.decode(_terms, (uint256));
        (, uint256 value_,) = _executionCallData.decodeSingle();
        uint256 newSpent = spentMap[msg.sender][_delegationHash] += value_;
        require(newSpent <= maxBudget, "BudgetLimitEnforcer:budget-exceeded");
    }
}
```

### Key Patterns for Custom Enforcers

1. **Inherit `CaveatEnforcer`** (not `ICaveatEnforcer`) to get empty default hooks and modifiers
2. **Override only the hooks you need** -- most enforcers only use `beforeHook`
3. **Use `_delegationHash` as state key** -- tracks per-delegation limits
4. **`msg.sender` is the DelegationManager** -- not the redeemer. Use it as part of the mapping key.
5. **Use modifiers** like `onlySingleCallTypeMode` and `onlyDefaultExecutionMode`
6. **Decode `_executionCallData`** using `ExecutionLib.decodeSingle()` -> returns `(address target, uint256 value, bytes calldata callData)`

---

## 10. Practical Architecture for AI Agent Delegation System

### Your Use Case: Orchestrator -> Sub-agents with Budget Limits

```
Orchestrator Agent (HybridDeleGator Smart Account)
    |
    |-- Delegation D1 to DeFi Agent
    |   caveats: [
    |     AllowedTargetsEnforcer(Uniswap, Aave),
    |     AllowedMethodsEnforcer(swap, supply),
    |     ERC20TransferAmountEnforcer(USDC, 500e6),
    |     TimestampEnforcer(now, now+24h),
    |     LimitedCallsEnforcer(10)
    |   ]
    |
    |-- Delegation D2 to Bridge Agent
    |   caveats: [
    |     AllowedTargetsEnforcer(BridgeContract),
    |     NativeTokenTransferAmountEnforcer(0.5 ETH),
    |     LimitedCallsEnforcer(3)
    |   ]
    |
    |-- Delegation D3 to Yield Agent (open re-delegation allowed)
        caveats: [
          AllowedTargetsEnforcer(AavePool),
          ERC20PeriodTransferEnforcer(USDC, 100e6, 1 day, startDate),
          RedeemerEnforcer(yieldAgentAddress)
        ]
```

### SDK Code for Creating Agent Delegations

```typescript
import { createDelegation, createCaveatBuilder, createExecution, ExecutionMode } from "@metamask/smart-accounts-kit"
import { DelegationManager } from "@metamask/smart-accounts-kit/contracts"
import { parseUnits, encodeFunctionData, erc20Abi } from "viem"

// 1. Create delegation from orchestrator to DeFi sub-agent
const caveatBuilder = createCaveatBuilder(environment)

const caveats = caveatBuilder
    .addCaveat("allowedTargets", [UNISWAP_ROUTER, AAVE_POOL])
    .addCaveat("allowedMethods", ["0x38ed1739", "0x617ba037"])  // swapExactTokensForTokens, deposit
    .addCaveat("erc20TransferAmount", { token: USDC_ADDRESS, amount: parseUnits("500", 6) })
    .addCaveat("limitedCalls", 10n)

const delegation = createDelegation({
    to: defiAgentAddress,
    from: orchestratorSmartAccount.address,
    environment: orchestratorSmartAccount.environment,
    caveats: caveats,
})

// 2. Sign it
const signature = await orchestratorSmartAccount.signDelegation({ delegation })
const signedDelegation = { ...delegation, signature }

// 3. Sub-agent redeems
const execution = createExecution({
    target: UNISWAP_ROUTER,
    callData: encodeFunctionData({
        abi: uniswapAbi,
        functionName: "swapExactTokensForTokens",
        args: [amountIn, amountOutMin, path, recipient, deadline]
    })
})

const redeemCalldata = DelegationManager.encode.redeemDelegations({
    delegations: [[signedDelegation]],
    modes: [ExecutionMode.SingleDefault],
    executions: [[execution]],
})

await bundlerClient.sendUserOperation({
    account: defiAgentSmartAccount,
    calls: [{ to: defiAgentSmartAccount.address, data: redeemCalldata }],
})
```

### Key Design Decisions for Your System

1. **All agents should be HybridDeleGator smart accounts** -- supports ECDSA signing (easy for server-side agents) and can act as both delegator and delegate.

2. **The orchestrator is the root delegator** -- it holds the funds and creates root delegations.

3. **Sub-agents redeem via UserOperations** -- they call `redeemDelegations()` which causes the orchestrator's account to execute the DeFi action.

4. **For sub-delegation (agent -> sub-agent)**: The middle agent signs a new Delegation with `authority = hash(parentDelegation)`. The leaf agent then provides the full chain `[leafDelegation, middleDelegation, rootDelegation]` when redeeming.

5. **Revocation**: The orchestrator can call `disableDelegation()` to instantly revoke any agent's permissions.

6. **Budget tracking is automatic**: `ERC20TransferAmountEnforcer` and `NativeTokenTransferAmountEnforcer` track cumulative spending per delegation hash. No off-chain accounting needed.
