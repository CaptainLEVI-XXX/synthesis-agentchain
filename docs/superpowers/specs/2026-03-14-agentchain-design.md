# AgentChain — The Service Network for AI Agents

**Date:** 2026-03-14
**Hackathon:** Synthesis Hackathon (March 4–25, 2026)
**Chain:** Base (Sepolia for dev, mainnet-ready)

## Overview

AgentChain is a decentralized protocol where AI agents register capabilities, discover each other, delegate work through MetaMask Delegation Framework, settle payments via Alkahest escrow, and build on-chain reputation using ERC-8004. The core innovation is the **agent discovery + hiring + proof layer** that connects ERC-8004 identity/reputation with MetaMask delegation chains with escrow settlement.

Users (EOAs) post tasks with escrowed funds. Orchestrator agents (ERC-4337 smart accounts) compete with proposals. The winning orchestrator builds a delegation chain of specialist agents, each authorized via MetaMask delegations with composed caveats. The custom Alkahest arbiter verifies delegation chain integrity, stake-weighted consensus, and reputation gates before releasing funds.


## Architecture

### Core Components

```
┌──────────────────────────────────────────────────────────────┐
│                     AgentChain Protocol                       │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │ AgentRegistry    │  │ AgentCapabilityEnforcer           │  │
│  │ + ERC-8004 ID    │  │ (custom MetaMask CaveatEnforcer)  │  │
│  │ + ENS display    │  │ + composed built-in enforcers     │  │
│  └────────┬─────────┘  └──────────┬───────────────────────┘  │
│           │                       │                          │
│           │              ┌────────┴──────────┐               │
│           │              │ DelegationTracker  │               │
│           │              │ (tasks + chains)   │               │
│           │              └────────┬──────────┘               │
│           │                       │                          │
│  ┌────────┴───────────────────────┴──────────────────────┐   │
│  │ AgentChainArbiter (Alkahest IArbiter)                 │   │
│  │ 3-layer verification:                                  │   │
│  │  1. Delegation chain integrity (DelegationManager)     │   │
│  │  2. Stake-weighted consensus (AgentRegistry.stakes)    │   │
│  │  3. Reputation gate (ERC-8004 Reputation Registry)     │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         │              │              │              │
    MetaMask        Alkahest       ERC-8004         Olas
    Delegation      Escrow         Identity +     Marketplace
    Framework       Protocol       Reputation     (mech-client)
    (v1.3.0)        (Arkhai)       Registries
```

### External Dependencies

- **MetaMask Delegation Toolkit (Smart Accounts Kit v1.3.0)** — ERC-7710/7715 delegation framework with 37 caveat enforcers, sub-delegation chains, HybridDeleGator smart accounts, deployed on Base at `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`
- **Alkahest Escrow Protocol** — Conditional peer-to-peer escrow by Arkhai. EAS-based, pluggable arbiters (`IArbiter`), supports ERC-20. Deployed on Base Sepolia.
- **ERC-8004 Identity Registry** — On-chain agent identity standard, deployed at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on 40+ chains including Base
- **ERC-8004 Reputation Registry** — Permissionless reputation with tag-based filtering, deployed at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- **Olas Mech Marketplace** — External agent marketplace, accessed via `mech-client`
- **ENS** — Name resolution for agent display names (display-only, light integration)

## Smart Contracts

> **Canonical reference:** See `docs/smart-contracts.md` for full Solidity code. This section is a summary.

### Key Design Decisions

- **`taskId`** is the EAS attestation UID returned by Alkahest's `makeStatement()`. Single source of truth across all contracts.
- **Payment model:** Escrow pays the orchestrator in full. Orchestrator distributes to sub-agents via direct transfers. Incentivized by ERC-8004 reputation.
- **Capabilities** stored as `bytes32` hashes (`keccak256(abi.encodePacked(capName))`). SDK handles conversion.
- **Reputation:** ERC-8004 Reputation Registry (canonical, deployed). Feedback tagged `tag1="agentchain"`, `tag2="delegation"/"dispute"`. Rating: int128 fixed-point with 1 decimal (45 = 4.5 stars).
- **Delegation model:** Agents are HybridDeleGator smart accounts (ERC-4337). Users stay as EOAs. Our custom `AgentCapabilityEnforcer` composes with 5 built-in MetaMask enforcers.
- **Depth tracking:** SDK encodes `currentDepth + 1` in new delegation's `AgentTerms`. Immutable per-delegation, enforced across the full chain.
- **Slashing** is out of scope for hackathon. Reputation damage is the penalty.
- **Proposals** are EIP-712 signed, stored on off-chain relay (Express.js), verified on-chain when accepted.

### Contracts

| Contract | Purpose |
|----------|---------|
| `AgentRegistry.sol` | Registration (`registerAndStake()` / `register()`), staking, ERC-8004 identity, ENS display, capability indexing |
| `AgentCapabilityEnforcer.sol` | Custom MetaMask CaveatEnforcer — checks agent registration, stake, capabilities, depth. Composes with built-in enforcers (AllowedTargets, AllowedMethods, ERC20TransferAmount, Timestamp, LimitedCalls) |
| `DelegationTracker.sol` | Task lifecycle, delegation chain recording (with MetaMask delegation hashes), work records |
| `AgentChainArbiter.sol` | Alkahest IArbiter with 3-layer verification: delegation chain integrity, stake-weighted consensus, reputation-gated release. Plus settlement + ERC-8004 feedback |

**Removed:** `ReputationTracker.sol` — replaced by ERC-8004 Reputation Registry at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.

### AgentChainArbiter — 3-Layer Verification (Novel)

```
checkStatement() called by Alkahest during collectPayment():

Layer 1: Delegation Chain Integrity
  → For each hop, check DelegationManager.disabledDelegations(hash) == false
  → Ensures no delegation was revoked mid-task

Layer 2: Stake-Weighted Consensus
  → sum(stake of agents WITH work records) / sum(stake of ALL agents) >= threshold
  → Proof-of-stake for service delivery, not a headcount

Layer 3: Reputation-Gated Release (optional, for mature ecosystem)
  → Each agent's ERC-8004 reputation (filtered by "agentchain" tag) >= minimum
  → Creates feedback loop: good work → reputation → access to higher-value escrows
```

## SDK (`@agentchain/sdk`)

### Structure

```
@agentchain/sdk
├── core/
│   ├── registry.ts       — AgentRegistry contract interactions + string↔bytes32 capability conversion
│   ├── discovery.ts      — Capability-based agent search (AgentChain + Olas) + ERC-8004 reputation queries
│   ├── delegation.ts     — MetaMask Smart Accounts Kit wrapper, caveat composition, depth tracking
│   ├── accounts.ts       — HybridDeleGator smart account creation via SimpleFactory
│   ├── escrow.ts         — Alkahest escrow creation & monitoring
│   ├── reputation.ts     — ERC-8004 Reputation Registry queries (getSummary with tag filters)
│   └── olas-bridge.ts    — mech-client wrapper for Olas marketplace
├── relay/
│   └── proposals.ts      — Off-chain proposal relay client (EIP-712 signed proposals)
├── events/
│   ├── listener.ts       — On-chain event listeners
│   └── filters.ts        — Filter events by capability match
├── types/
│   └── index.ts          — TypeScript types, EIP-712 type definitions
└── index.ts              — Main AgentChain export
```

### Provider Side (Agent Builders)

```typescript
import { AgentChain } from '@agentchain/sdk';

// 1. Create HybridDeleGator smart account for agent (one-time)
const agentAccount = await AgentChain.createAgentAccount({
  signer: agentPrivateKey, // ECDSA — ideal for server-side agents
});

// 2. Register agent on-chain (calls AgentRegistry.registerAndStake)
//    SDK converts capability strings to bytes32 hashes
//    Also registers ERC-8004 identity (returns erc8004Id)
const agent = await AgentChain.register({
  name: "AaveYieldScanner",
  capabilities: ["aave", "lending", "yield-analysis"],
  endpoint: "https://my-agent.com/api",
  agentURI: "ipfs://Qm.../agent.json", // ERC-8004 agent descriptor
  stake: 500, // USDC — can only accept tasks where budget <= 500
});

// 3. Listen for tasks matching capabilities
agent.onTask(async (task) => {
  await agent.propose(task.id, {
    strategy: "Aave v3 ETH pool optimization",
    fee: 50,
  });
});

// 4. Handle delegation when selected — redeem via MetaMask delegation
agent.onDelegation(async (delegation) => {
  const result = await doYieldAnalysis(delegation.taskSpec);
  // Submit work record to DelegationTracker
  await agent.submitWorkRecord(delegation.taskId, {
    resultHash: result.ipfsHash,
    summary: "Allocated to Aave v3 ETH pool at 8.4% APR",
  });
});
```

### Consumer Side (Orchestrator Agents)

```typescript
// Discover agents — AgentChain registry + ERC-8004 reputation filter + Olas fallback
const experts = await AgentChain.discover({
  capability: "aave",
  minReputation: 4.0, // SDK queries ERC-8004 getSummary with tag="agentchain"
  sources: ["agentchain", "olas"],
});

// Create MetaMask delegation with composed caveats
// SDK automatically composes: AgentCapabilityEnforcer + AllowedTargetsEnforcer
// + ERC20TransferAmountEnforcer + TimestampEnforcer + LimitedCallsEnforcer
const delegation = await AgentChain.delegate({
  to: experts[0].address,
  task: { type: "yield-analysis", spec: { amount: 5000 } },
  budget: 100,                    // USDC — encoded in ERC20TransferAmountEnforcer
  targets: [AAVE_POOL],           // encoded in AllowedTargetsEnforcer
  methods: ["supply", "withdraw"], // encoded in AllowedMethodsEnforcer
  maxDepth: 3,
  maxCalls: 10,                   // encoded in LimitedCallsEnforcer
  expiry: Date.now() + 86400_000, // encoded in TimestampEnforcer
  taskId: task.escrowId,
  // SDK encodes currentDepth = parentDelegation.currentDepth + 1
});

const result = await delegation.waitForWorkRecord({ timeout: 300_000 });
```

### User Side (EOA — no smart account needed)

```typescript
// Create task with Alkahest escrow (simple EOA transaction)
const task = await AgentChain.createTask({
  description: "Invest 5000 USDC for best yield across DeFi",
  budget: 5000,
  token: "USDC",
  deadline: Math.floor(Date.now() / 1000) + 86400,
  requiredCapabilities: ["defi", "yield"],
  // Arbiter verification params:
  stakeThreshold: 75,     // 75% stake-weighted completion required
  minReputation: 3.0,     // agents need >= 3.0 stars on ERC-8004
  reputationRequired: true,
});
// Under the hood:
// 1. approve USDC → Alkahest ERC20EscrowObligation
// 2. call makeStatement() with demand=DemandData{taskId, orchestrator, stakeThresholdBps:7500, minReputation:30, reputationRequired:true}
// 3. call DelegationTracker.registerTask(taskId, deadline)

// Review proposals (from off-chain relay, EIP-712 verified)
const proposals = await task.getProposals();
await task.accept(proposals[0]);

// Settlement — orchestrator calls Alkahest.collectPayment()
// AgentChainArbiter.checkStatement() runs 3-layer verification
// Then task creator calls settleAndRate() to submit ERC-8004 feedback
await task.settleAndRate(45); // 4.5 stars for all agents
```

### Olas Bridge

```typescript
// sdk/core/olas-bridge.ts
import { MechClient } from 'mech-client';

export async function hireOlasMech(task: TaskSpec): Promise<Result> {
  const client = new MechClient({ chain: "base" });
  return await client.request({ prompt: task.spec, tool: task.mechType || "openai-gpt4" });
}
```

The orchestrator calls Olas off-chain. On-chain, the orchestrator submits the work record as its own. No contract changes — Olas integration lives entirely in the SDK.

## Data Flow

### Complete End-to-End Sequence

**Phase 1: Setup**
1. User (EOA) approves USDC to Alkahest `ERC20EscrowObligation`
2. User calls SDK `createTask()` → Alkahest `makeStatement()` → receives `taskId` (EAS attestation UID)
3. SDK calls `DelegationTracker.registerTask(taskId, deadline)`
4. Funds locked in escrow with `AgentChainArbiter` as arbiter, demand encodes `DemandData{taskId, orchestrator, stakeThresholdBps, minReputation, reputationRequired}`
5. `TaskRegistered` event emitted

**Phase 2: Autonomous Pickup**
6. Orchestrator agents (HybridDeleGator smart accounts) listen for `TaskRegistered` filtered by capability match
7. First qualified orchestrator calls `DelegationTracker.claimTask(taskId)` — no proposal step
8. Contract verifies orchestrator is registered + staked
9. `TaskAccepted` event emitted

**Phase 3: Delegation Chain (MetaMask Delegation Framework)**
11. Orchestrator calls `getAgentsByCapability()` on `AgentRegistry`, filters by ERC-8004 reputation via SDK
12. For each sub-task, orchestrator creates MetaMask delegation with **composed caveats**:
    - `AgentCapabilityEnforcer` (our custom: registered, staked, capabilities, depth)
    - `AllowedTargetsEnforcer` (built-in: which contracts agent can call)
    - `AllowedMethodsEnforcer` (built-in: which functions)
    - `ERC20TransferAmountEnforcer` (built-in: budget cap)
    - `TimestampEnforcer` (built-in: expiry)
    - `LimitedCallsEnforcer` (built-in: max redemptions)
13. Sub-agent redeems delegation → DelegationManager validates full caveat chain
14. `AgentCapabilityEnforcer.beforeHook` validates: registered, staked, capabilities, depth
15. `AgentCapabilityEnforcer.afterHook` records delegation hop + delegation hash in DelegationTracker
16. If no AgentChain agent found → hire Olas mech via `mech-client` (off-chain)

**Phase 4: Work Execution**
17. Sub-agents receive delegations, perform work (DeFi execution via delegation redemption, or off-chain)
18. Sub-agents can sub-delegate with **stricter** caveats — SDK sets `currentDepth + 1`, smaller budget, fewer targets
19. Caveat attenuation: all ancestor caveats enforced automatically by DelegationManager
20. Each agent submits work record to `DelegationTracker` (IPFS result hash + summary)
21. `WorkCompleted` events emitted

**Phase 5: Settlement (3-Layer Verification)**
22. Orchestrator calls `collectPayment()` on Alkahest
23. `AgentChainArbiter.checkStatement()` runs three verification layers:
    - **Layer 1: Chain integrity** — every delegation hash is live (not revoked via `DelegationManager.disabledDelegations`)
    - **Layer 2: Stake-weighted consensus** — `sum(completedStake) / sum(totalStake) >= stakeThresholdBps`
    - **Layer 3: Reputation gate** — every agent's ERC-8004 reputation >= `minReputation` (if enabled)
24. If all three pass → Alkahest releases full USDC to orchestrator's smart account

**Phase 5b: Execution + Distribution**
25. Orchestrator deducts agent fees, pays sub-agents via direct USDC transfers
26. Orchestrator executes the winning DeFi strategy with remaining capital (e.g., Aave.supply())
27. Orchestrator transfers resulting tokens (e.g., aUSDC) back to user's EOA
28. If orchestrator fails to return tokens → user disputes via `disputeAgent()` → reputation tanks

**Phase 6: Reputation Feedback (ERC-8004)**
26. Task creator calls `AgentChainArbiter.settleAndRate(taskId, rating)`
27. Submits `giveFeedback()` to ERC-8004 Reputation Registry for each agent with work records
28. Feedback tagged `tag1="agentchain"`, `tag2="delegation"` — filterable across ecosystem
29. Marks task as Completed in DelegationTracker
30. (Optional) `disputeAgent()` submits negative ERC-8004 feedback with `tag2="dispute"` + IPFS evidence

## Error Handling & Edge Cases

### Failure Scenarios

**Agent fails to complete before deadline:**
- Escrow has a deadline set by user
- Deadline passes without all work records → escrow reverts to user
- `AgentChainArbiter.checkStatement()` returns false
- Agents who DID submit work records get reputation credit but no payment
- Orchestrator takes the reputation hit

**Agent submits garbage work record:**
- Work record proves submission, not quality
- User can dispute after settlement via `AgentChainArbiter.disputeAgent()`
- Submits negative ERC-8004 feedback (tag: "agentchain/dispute") with IPFS evidence
- Low reputation → fails reputation gate → locked out of future high-value escrows
- No on-chain fraud proof (out of scope for hackathon)

**Orchestrator goes offline mid-task:**
- Deadline expires → escrow reverts to user
- Orchestrator gets no ERC-8004 feedback (implicit penalty — misses out on positive ratings)
- User can resubmit task with different orchestrator

**Orchestrator doesn't pay sub-agents after settlement:**
- Sub-agents call `disputeAgent()` against orchestrator
- Negative ERC-8004 reputation → orchestrator fails reputation gates
- For hackathon: trust assumption on orchestrator, enforced by reputation
- Future improvement: per-agent escrow splits

**Delegation revoked mid-task:**
- Orchestrator calls `DelegationManager.disableDelegation()` to revoke an agent
- `checkStatement()` Layer 1 detects revoked delegation → escrow cannot be collected
- Protects against compromised agents continuing to act after revocation

**No agents found for capability:**
- AgentChain registry returns empty → SDK checks Olas marketplace
- Olas also empty → orchestrator reports failure to user
- Task can be cancelled, escrow returns to user
- No reputation penalty (honest failure)

**Delegation depth limit hit:**
- `AgentCapabilityEnforcer` rejects delegation where `currentDepth >= maxDepth`
- Sub-agent must do the work itself or fail

**Malicious agent registers fake capabilities:**
- Stake requirement creates economic cost to spam
- Stake must cover task budget — can't take big tasks with small stake
- Bad results → disputes → reputation tanks → never discovered again

### Stake-as-Qualification Rule

Agents can only accept tasks where `taskBudget <= agentStake`. This ensures:
- Skin in the game proportional to task value
- Self-selection — agents only bid on tasks they can financially back
- Economic deterrent against spam registrations

### Out of Scope (Hackathon)

- On-chain fraud proofs / ZK verification of work quality
- Partial completion / partial payouts
- Multi-token escrow (USDC only)
- Agent capability versioning
- Cross-chain delegation (Base only)
- Stake slashing (reputation-only penalties for hackathon)
- Unstake cooldown mechanism (direct withdrawal for hackathon)
- Per-agent escrow splits (orchestrator distributes for hackathon)

## Testing Strategy

1. **Unit tests** — each contract function in isolation (see `docs/smart-contracts.md` for full test plan)
2. **Integration test** — full flow: register → escrow → delegate → redeem → work record → settle → reputation
3. **Arbiter verification tests** — chain integrity (revoked delegations), stake-weighted consensus, reputation gate
4. **MetaMask delegation tests** — caveat composition, sub-delegation attenuation, revocation
5. **Olas integration test** — 10+ requests on Olas marketplace (bounty requirement)
6. **Unhappy paths** — deadline expiry, failed work records, depth limits, insufficient stake, revoked delegations
7. **Access control tests** — verify only authorized callers can record delegations, settle tasks

## Deployment

- **Development:** Base Sepolia
- **Target:** Base mainnet-ready
- **Contracts:** AgentRegistry, AgentCapabilityEnforcer, DelegationTracker, AgentChainArbiter
- **External (already deployed):** MetaMask DelegationManager (`0xdb9B...`), ERC-8004 Identity (`0x8004A1...`), ERC-8004 Reputation (`0x8004BA...`), all built-in MetaMask enforcers
- **Deployment order:** DelegationTracker → AgentCapabilityEnforcer → AgentChainArbiter → tracker.initialize()
- **Off-chain:** Proposal relay server (Express.js), IPFS for result data, ERC-4337 Bundler (Pimlico)
