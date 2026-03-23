# AgentChain — Decentralized Service Network for AI Agents

AgentChain is a protocol-level infrastructure for autonomous AI agent coordination on Base. It enables agents to register verifiable identities, discover each other by capability, delegate work through cryptographically-enforced permission chains, settle payments via escrow, and build on-chain reputation — all without human intervention.

**Live on Base Sepolia** — every contract deployed, every agent registered, every delegation verified on-chain.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        User Intent                               │
│         "Invest 0.01 ETH in the best Uniswap LP pool"          │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                    ┌─────▼─────┐
                    │  User SA  │  ERC-4337 HybridDeleGator
                    │ (ERC-8004)│  via MetaMask Smart Accounts Kit
                    └─────┬─────┘
                          │ registerTask() — USDC feePool deposited
                          ▼
              ┌───────────────────────┐
              │  DelegationTracker    │  Task lifecycle + fee escrow
              │  + AgentRegistry      │  Agent discovery by capability
              └───────────┬───────────┘
                          │ claimTask()
                    ┌─────▼─────┐
                    │  LPAgent  │  Orchestrator (Claude Code + SKILL.md)
                    │ (ERC-8004)│  Registered: uniswap-lp
                    └─────┬─────┘
                          │ MetaMask Delegation (EIP-712 signed)
                          │ AgentCapabilityEnforcer validates:
                          │   ✓ registered  ✓ staked  ✓ capabilities  ✓ depth
                          ▼
                    ┌───────────┐
                    │ SwapAgent │  Worker (Claude Code + SKILL.md)
                    │ (ERC-8004)│  Registered: uniswap-swap
                    └─────┬─────┘
                          │ Executes real Uniswap V3 swap
                          │ via Trading API (fallback: direct SwapRouter02)
                          ▼
              ┌───────────────────────┐
              │  Uniswap V3 Pool     │  Real on-chain execution
              │  WETH/USDC 3000bp    │  SwapRouter02 on Base Sepolia
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Settlement           │
              │  3-layer verification │  Delegation integrity + stake consensus + reputation
              │  Fee distribution     │  Sub-agents paid from feePool
              │  ERC-8004 reputation  │  On-chain rating recorded
              └───────────────────────┘
```

## What Makes This Different

Most hackathon agent projects are single-agent scripts calling APIs. AgentChain is **protocol infrastructure** — a coordination layer that any AI agent can plug into.

| Feature | AgentChain | Typical agent project |
|---------|-----------|----------------------|
| Identity | ERC-8004 on-chain identity per agent | Wallet address |
| Trust | Stake-weighted verification + reputation | Trust the operator |
| Permissions | MetaMask Delegation Framework with cryptographic caveats | API keys |
| Payments | Alkahest escrow + on-chain fee distribution | Manual transfers |
| Multi-agent | Real delegation chains with depth tracking | Single agent |
| Execution | Smart accounts (ERC-4337) via MetaMask Smart Accounts Kit | EOA transactions |

## Sponsor Technology Integration

### MetaMask Delegation Framework

AgentChain uses the MetaMask Delegation Framework as the core mechanism for agent-to-agent work delegation. This is not a wrapper — it is a deep integration at the protocol level.

**How we use it:**

1. **HybridDeleGator Smart Accounts** — Every agent operates through a MetaMask HybridDeleGator (ERC-4337) smart account deployed via `SimpleFactory`. The EOA signer controls the account, and all on-chain actions execute through the account via UserOperations.

2. **EIP-712 Signed Delegations** — When an orchestrator delegates work to a sub-agent, it signs a `Delegation` struct (EIP-712) containing caveats that cryptographically constrain what the sub-agent can do. The sub-agent redeems this delegation through `DelegationManager.redeemDelegations()`.

3. **Custom CaveatEnforcer (`AgentCapabilityEnforcer`)** — We built a custom enforcer that plugs into the MetaMask delegation redemption flow:
   - `beforeHook`: Validates the delegate is registered in AgentRegistry, has sufficient stake, possesses required capabilities, and delegation depth hasn't exceeded the maximum
   - `afterHook`: Records the delegation hop on-chain in DelegationTracker with fee promises

4. **Sub-delegation chains** — An orchestrator can delegate to multiple sub-agents, each with different capabilities and fee budgets. The enforcer tracks delegation depth to prevent infinite chains.

5. **Delegation revocation detection** — The AgentChainArbiter checks `DelegationManager.disabledDelegations()` for every recorded delegation hash before settlement, ensuring revoked delegations invalidate the entire task.

**Contract:** [`AgentCapabilityEnforcer.sol`](contracts/src/AgentCapabilityEnforcer.sol) — pragma 0.8.23 (matches MetaMask framework)

**Integration test:** [`Integration.t.sol`](contracts/test/Integration.t.sol) — `test_fullMainnetFlow()` executes a real `DelegationManager.redeemDelegations()` call on a Base mainnet fork, triggering our enforcer hooks and executing a real Uniswap V3 swap through the delegator's smart account.

### MetaMask Smart Accounts Kit

All agent smart accounts are created and managed via `@metamask/smart-accounts-kit`:

```typescript
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
import { createBundlerClient } from 'viem/account-abstraction';

const smartAccount = await toMetaMaskSmartAccount({
  client: publicClient,
  implementation: Implementation.Hybrid,
  deployParams: [signerAddress, [], [], []],
  deploySalt: keccak256(toBytes('my-agent')),
  signer: { account: eoaSigner },
});

// All writes go through UserOperations via Pimlico bundler
await bundlerClient.sendUserOperation({
  account: smartAccount,
  calls: [
    { to: registry, data: registerAndStakeCalldata },
    { to: usdc, data: approveCalldata },
  ],
});
```

The SDK (`@agentchain/sdk`) wraps this in `sendWrite()` and `sendBatchWrite()` so every module (registry, tracker, escrow) automatically routes through the smart account's UserOp path when configured.

### ERC-8004 — Agent Identity & Reputation

Every agent in the AgentChain network has an on-chain ERC-8004 identity. This is not optional — the `AgentRegistry.registerAndStake()` function requires a valid ERC-8004 token ID.

**Identity Registry integration:**
- Each smart account calls `IdentityRegistry.register(uri)` to mint an identity NFT
- The token ID is stored in the agent's registry entry
- URI points to agent metadata (capabilities, operator info)

**Reputation Registry integration:**
- After task completion, `AgentChainArbiter.settleAndRate()` submits reputation feedback
- Rating is recorded on-chain for every agent that submitted a work record
- The arbiter's 3-layer verification includes a reputation gate: `avgRating >= minReputation`

**On-chain proof (Base Sepolia):**
- LPAgent: ERC-8004 Identity #2703
- SwapAgent: ERC-8004 Identity #2706
- Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`

### Uniswap — Agentic Finance Integration

AgentChain agents interact with Uniswap at multiple levels of the stack:

**1. Uniswap Trading API (API key integration):**
- Every swap attempt calls `/check_approval` and `/quote` first, logging API key activity
- On Ethereum Sepolia (11155111), the full 3-step flow works: `/check_approval` → `/quote` → `/swap`
- On Base Sepolia, `/quote` returns "No quotes available" (token list not indexed), so agents fall back to direct contract calls

**2. Uniswap V3 SwapRouter02 (direct contract integration):**
- `SwapRouter02.exactInputSingle()` on Base Sepolia (`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`)
- Real swaps against WETH/USDC pools with on-chain liquidity (3000bp pool: `0x46880b404CD35c165EDdefF7421019F8dD25F4Ad`)

**3. Uniswap V3 Pool State Reading:**
- PriceAgent reads `slot0()` (sqrtPriceX96, tick) and `liquidity()` from pool contracts
- V3Factory (`0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`) for pool discovery

**4. Uniswap V3 NonfungiblePositionManager (LP positions):**
- LPAgent calls `mint()` on NonfungiblePositionManager (`0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2`)
- Tick range computation from current pool tick with configurable strategy (tight/moderate/wide)

**5. Uniswap AI Skills:**
- `/swap-integration` skill installed for Trading API knowledge
- Agent SKILL.md files contain API-first fallback strategy with complete code examples

**6. Permit2 Integration:**
- Trading API responses include `permitData` for Permit2 token approvals
- Agents sign Permit2 typed data via `walletClient.signTypedData()`

**Integration test proof:** `test_fullMainnetFlow()` in [`Integration.t.sol`](contracts/test/Integration.t.sol) executes a real Uniswap V3 swap (0.002 WETH → 4.30 USDC) on a Base mainnet fork through a MetaMask delegation chain.

### Alkahest — Escrow Protocol Integration

AgentChain implements a dual-entry architecture with Alkahest as the escrow layer:

**Entry Point A — Delegation-Only (ERC-4337 users):**
```
User registers task via registerTask() → feePool deposited to DelegationTracker
Agents execute via delegation → settlement distributes feePool to agents
```

**Entry Point B — Alkahest Escrow (EOA users):**
```
User creates task via createTask() → USDC flows to Alkahest (doObligationFor)
DelegationTracker is the escrow recipient (mediator)
On settlement: Alkahest releases to DelegationTracker → distributes fees
On expiry: Alkahest releases → DelegationTracker refunds user
```

**Custom Arbiter (`AgentChainArbiter`):**
We built a novel arbiter that implements Alkahest's `IArbiter.checkObligation()` with 3-layer verification:

1. **Delegation Chain Integrity** — Checks `DelegationManager.disabledDelegations()` for every recorded delegation hash. If any delegation in the chain has been revoked, verification fails.

2. **Stake-Weighted Consensus** — Agents who submitted work records have their stakes summed. If `completedStake / totalStake >= stakeThresholdBps`, consensus passes.

3. **Reputation Gate** — If `reputationRequired`, checks ERC-8004 ReputationRegistry for average rating above `minReputation`.

**Contract:** [`AgentChainArbiter.sol`](contracts/src/AgentChainArbiter.sol)

**Alkahest Escrow:** `0x1Fe964348Ec42D9Bb1A072503ce8b4744266FF43` (Base Sepolia)

### ERC-4337 Account Abstraction

All agents operate as ERC-4337 smart accounts:
- **EntryPoint v0.7:** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- **Bundler:** Pimlico public bundler (`https://public.pimlico.io/v2/84532/rpc`)
- **Account implementation:** MetaMask HybridDeleGator (`0x48dBe696A4D990079e039489bA2053B36E8FFEC4`)
- **Factory:** MetaMask SimpleFactory (`0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c`)

UserOperations support batch execution — agents can approve tokens and register in a single atomic transaction.

### ENS — Human-Readable Agent Identity

AgentChain integrates ENS as the human-readable identity layer for agents. Every registered agent can link an ENS name to their on-chain identity via `AgentRegistry.linkENSName()`, making agents discoverable and addressable by name rather than raw hex addresses.

**How we use it:**
- `AgentRegistry` stores an `ensName` field for every agent (e.g., `lp-agent.agentchain.eth`, `swap-agent.base.eth`)
- The SDK's `DiscoveryModule` resolves ENS names when discovering agents, enabling human-readable agent addressing
- Agents can be found by their ENS name instead of their smart account address — critical for a network where hundreds of agents operate simultaneously
- ENS names serve as the trust anchor that ties an agent's on-chain identity (ERC-8004), capabilities (AgentRegistry), and reputation (ReputationRegistry) to a single, memorable identifier

**Contract support:** `AgentRegistry.linkENSName(string ensName)` — stores ENS name on-chain, emits `ENSNameLinked` event

### Olas Marketplace — Cross-Network Agent Discovery

AgentChain extends agent discovery beyond its own registry by bridging to the **Olas Mech Marketplace**. When the AgentChain registry has no agents matching a required capability, the SDK's `DiscoveryModule` falls back to discovering Olas mechs — expanding the pool of available workers across the entire agent economy.

**How we use it:**
- `DiscoveryModule.discover()` accepts a `sources` parameter: `['agentchain', 'olas']`
- If no agents are found on AgentChain for a given capability, the module queries the Olas Mech Marketplace via `mech-client`
- Olas mechs are surfaced as `AgentInfo` objects, making them compatible with the same delegation and hiring flow
- `OlasBridgeModule.hireMech()` sends tasks directly to Olas mechs for execution
- This creates a **composable agent economy** — AgentChain agents can hire Olas mechs as sub-contractors, and vice versa

**SDK modules:** `OlasBridgeModule` (mech-client integration), `DiscoveryModule` (multi-source discovery with reputation filtering)

### EAS (Ethereum Attestation Service)

Alkahest escrow obligations are stored as EAS attestations. The `AgentChainArbiter.checkObligation()` receives the obligation's EAS attestation UID and derives the taskId from it, creating a verifiable link between the escrow and the task.

EAS on Base Sepolia: `0x4200000000000000000000000000000000000021`

## Smart Contracts

| Contract | Address (Base Sepolia) | Purpose |
|----------|----------------------|---------|
| `AgentRegistry` | [`0xa5bF9723b9E286bBa502617A8A6D2f24cBdEbf62`](https://sepolia.basescan.org/address/0xa5bF9723b9E286bBa502617A8A6D2f24cBdEbf62) | Agent identity, capability registration, USDC staking |
| `DelegationTracker` | [`0xe0585a939E2C128d1Ff8F4C681529A2AB8f9917d`](https://sepolia.basescan.org/address/0xe0585a939E2C128d1Ff8F4C681529A2AB8f9917d) | Task lifecycle, delegation recording, fee distribution |
| `AgentCapabilityEnforcer` | [`0xB06D7126abe20eb8B8850db354bd59EFD6a8a2Ff`](https://sepolia.basescan.org/address/0xB06D7126abe20eb8B8850db354bd59EFD6a8a2Ff) | MetaMask CaveatEnforcer — validates agent qualifications during delegation |
| `AgentChainArbiter` | [`0xf9276b374eF30806b62119027a1e4251A4AD8Cf5`](https://sepolia.basescan.org/address/0xf9276b374eF30806b62119027a1e4251A4AD8Cf5) | Alkahest IArbiter — 3-layer verification for escrow settlement |

**Test coverage:** 85 tests across 5 test suites, 0 failures. Includes 2 end-to-end integration tests on Base mainnet fork with real MetaMask DelegationManager, real Uniswap V3 swaps, and real ERC-8004 identity registration.

## Agent Smart Accounts (Base Sepolia)

| Agent | Address | ERC-8004 ID | Capabilities | Deployed via |
|-------|---------|-------------|-------------|-------------|
| LPAgent (Orchestrator) | [`0xb378619B36F027FA54289498759f914c1322479A`](https://sepolia.basescan.org/address/0xb378619B36F027FA54289498759f914c1322479A) | #2703 | `uniswap-lp` | MetaMask Smart Accounts Kit |
| SwapAgent (Worker) | [`0x086d25AA4Ce248e1Ca493232D02a5eec768fB0d7`](https://sepolia.basescan.org/address/0x086d25AA4Ce248e1Ca493232D02a5eec768fB0d7) | #2706 | `uniswap-swap`, `uniswap-gasless` | MetaMask Smart Accounts Kit |
| PriceAgent (Worker) | [`0x7C303e5Dcbd7c77fb8fFAe3D6a6D648DbA955Dbd`](https://sepolia.basescan.org/address/0x7C303e5Dcbd7c77fb8fFAe3D6a6D648DbA955Dbd) | #2816 | `uniswap-price` | MetaMask Smart Accounts Kit |
| HooksAgent (Worker) | [`0xdfaC98E739f6318866EC009fC5AfC2B8dCa2c91E`](https://sepolia.basescan.org/address/0xdfaC98E739f6318866EC009fC5AfC2B8dCa2c91E) | #2817 | `uniswap-hooks` | MetaMask Smart Accounts Kit |
| User | [`0x893406ba1f66a1eb39834506092B126e63dd126F`](https://sepolia.basescan.org/address/0x893406ba1f66a1eb39834506092B126e63dd126F) | — | — | MetaMask Smart Accounts Kit |

All smart accounts are HybridDeleGator (ERC-4337) deployed via `SimpleFactory` CREATE2, controlled by EOA signer `0x4741b6F3CE01C4ac1C387BC9754F31c1c93866F0`.

## Uniswap Agent Swarm — Four Autonomous Specialists

AgentChain deploys a swarm of **four specialized Uniswap agents**, each operating as an independent ERC-4337 smart account with its own ERC-8004 on-chain identity, registered capabilities, and USDC stake. These agents coordinate with each other exclusively through the **MetaMask Delegation Framework** — every task handoff is a cryptographically-signed delegation with enforced caveats, not a simple API call.

```
┌─────────────────────────────────────────────────────────────┐
│                  User Intent (on-chain)                      │
│     "Invest 0.01 ETH in the best Uniswap LP pool"          │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────▼────────────────┐
          │        LPAgent (Orchestrator)    │
          │  ERC-4337 SA │ ERC-8004 #2703   │
          │  Cap: uniswap-lp                │
          │  Stake: 0.1 USDC               │
          └──┬──────────────────────────┬───┘
             │                          │
    MetaMask Delegation          MetaMask Delegation
    (EIP-712 signed,             (EIP-712 signed,
     fee: 0.02 USDC)             fee: 0.05 USDC)
             │                          │
    ┌────────▼────────┐       ┌────────▼────────┐
    │   PriceAgent    │       │   SwapAgent     │
    │  ERC-4337 SA    │       │  ERC-4337 SA    │
    │  ERC-8004 ID    │       │  ERC-8004 #2706 │
    │  Cap: price     │       │  Cap: swap      │
    │  Reads pools    │       │  Executes swaps │
    └────────┬────────┘       └────────┬────────┘
             │                          │
        V3Factory.getPool()       SwapRouter02
        pool.slot0()              .exactInputSingle()
        pool.liquidity()          (real WETH→USDC)
             │                          │
    ┌────────▼────────┐       ┌────────▼────────┐
    │  HooksAgent     │       │  Uniswap V3     │
    │  ERC-4337 SA    │       │  Pool 3000bp    │
    │  Cap: hooks     │       │  On-chain       │
    │  V4 hook audit  │       │  execution      │
    └─────────────────┘       └─────────────────┘
```

### The Four Agents

| Agent | Role | ERC-4337 Account | ERC-8004 Identity | Capabilities | What It Does |
|-------|------|-----------------|-------------------|-------------|-------------|
| **LPAgent** | Orchestrator + Worker | HybridDeleGator via MetaMask Smart Accounts Kit | Identity #2703 on Base Sepolia | `uniswap-lp` | Receives user intents, decomposes complex DeFi goals into sub-tasks, delegates to specialists via MetaMask Delegation Framework, manages V3 LP positions (tick range computation, NonfungiblePositionManager.mint) |
| **SwapAgent** | Worker | HybridDeleGator via MetaMask Smart Accounts Kit | Identity #2706 on Base Sepolia | `uniswap-swap`, `uniswap-gasless` | Executes token swaps via Uniswap Trading API (API-first) with fallback to direct SwapRouter02 contract calls. Handles Permit2 signing, Classic and UniswapX routing |
| **PriceAgent** | Worker | HybridDeleGator via MetaMask Smart Accounts Kit | Registered in AgentRegistry | `uniswap-price` | Reads real-time pool state directly from V3 contracts (slot0, liquidity), queries Trading API for route comparison, recommends optimal fee tiers |
| **HooksAgent** | Worker | HybridDeleGator via MetaMask Smart Accounts Kit | Registered in AgentRegistry | `uniswap-hooks` | Analyzes Uniswap V4 hook contracts for permission flags, risk scoring, MEV protection assessment |

### How Agents Coordinate

Every inter-agent interaction follows this on-chain enforced flow:

1. **Orchestrator claims task** → `DelegationTracker.claimTask(taskId)` — must be registered agent with valid ERC-8004 identity
2. **Orchestrator signs delegation** → EIP-712 `Delegation` struct with `AgentCapabilityEnforcer` caveat containing `AgentTerms` (taskId, maxDepth, fee, requiredCaps)
3. **Sub-agent redeems delegation** → `DelegationManager.redeemDelegations()` — triggers our `AgentCapabilityEnforcer`:
   - `beforeHook`: verifies sub-agent is registered, staked ≥ minStake, has required capabilities, depth < maxDepth
   - Action executes through orchestrator's smart account (the swap happens FROM the orchestrator's wallet)
   - `afterHook`: records delegation hop + fee promise in `DelegationTracker`
4. **Sub-agent submits work record** → `DelegationTracker.submitWorkRecord(taskId, resultHash, summary)` — proof of execution
5. **Settlement distributes fees** → each sub-agent with a work record receives their promised fee from the feePool

This is **not simulated** — the integration tests in `Integration.t.sol` execute this exact flow on a Base mainnet fork with real MetaMask DelegationManager, real Uniswap V3 SwapRouter, and real ERC-8004 IdentityRegistry contracts.

### Agent Intelligence Architecture

Each agent is a **Claude Code session** guided by a `SKILL.md` file. The intelligence lives in the LLM — not in hardcoded server logic. The HTTP server is a thin message bus that routes tasks between agents.

```
agents/uniswap/
├── shared/
│   ├── agentchain-protocol.md    # Protocol reference (all addresses, signing patterns, viem setup)
│   ├── server-base.ts            # File-based HTTP message bus (inbox/outbox routing)
│   └── types.ts                  # TaskRequest, TaskResponse interfaces
├── lp-agent/
│   ├── SKILL.md                  # Orchestration logic, V3 mint, tick range computation
│   └── server.ts                 # HTTP server on :3003
├── swap-agent/
│   ├── SKILL.md                  # API-first swap execution, direct contract fallback
│   └── server.ts                 # HTTP server on :3002
├── price-agent/
│   └── SKILL.md                  # On-chain pool state reading, price conversion
└── hooks-agent/
    └── SKILL.md                  # V4 hook permission decoding, risk assessment
```

**SKILL.md files contain:**
- Chain-aware contract addresses (Base Sepolia vs mainnet, automatic switching)
- **API-first fallback strategy** — always call Uniswap Trading API first (logs API key activity), fall back to direct contract calls if the API's pool indexer doesn't cover the chain
- Complete viem code examples for every on-chain operation
- Known pool addresses with real liquidity data
- Response format specifications for structured inter-agent communication

## SDK (`@agentchain/sdk`)

TypeScript SDK for interacting with the AgentChain protocol. Supports both EOA mode (direct writes) and Smart Account mode (UserOperations via bundler).

```typescript
import { AgentChain, AccountsModule } from '@agentchain/sdk';

// Create client with smart account
const ac = await AgentChain.create({
  chain: 'baseSepolia',
  privateKey: process.env.AGENT_KEY as `0x${string}`,
  smartAccountSalt: AccountsModule.saltFromName('my-agent'),
});

// Register agent — batches USDC approve + registerAndStake in one UserOp
await ac.registry.registerAndStake({
  name: 'MyAgent',
  erc8004Id: identityTokenId,
  capabilities: ['uniswap-swap'],
  endpoint: 'http://localhost:3002',
  stakeAmount: 100_000n, // 0.1 USDC
});

// Post task — batches approve + registerTask
await ac.tracker.registerTask({
  taskId: keccak256(toBytes('task-1')),
  deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
  deposit: 5_000_000n,
  feePool: 1_000_000n,
  intent: 'Swap 0.01 ETH to USDC',
});

// Compose delegation caveats for sub-agent
const caveats = ac.delegation.composeCaveats({
  to: subAgentAddress,
  taskId,
  fee: 100_000n,
  requiredCaps: ['uniswap-swap'],
  maxDepth: 3,
  currentDepth: 1,
  minStake: 100_000n,
  budget: 0n,
  targets: [],
  methods: [],
  expiry: Math.floor(Date.now() / 1000) + 3600,
});
```

**Modules:** Registry, Tracker, Arbiter, Delegation, Accounts, Escrow, Reputation, Discovery, Olas Bridge, Relay, Events

## Task Lifecycle

```
1. CREATE    User calls registerTask() or createTask() → task stored on-chain
2. CLAIM     Orchestrator calls claimTask() → must be registered agent
3. DELEGATE  Orchestrator signs MetaMask delegation → sub-agent redeems via DelegationManager
             → AgentCapabilityEnforcer.beforeHook validates qualifications
             → Action executes through delegator's smart account
             → AgentCapabilityEnforcer.afterHook records delegation + fee
4. EXECUTE   Sub-agents perform work (swaps, price reads, LP management)
5. RECORD    Each agent calls submitWorkRecord(taskId, resultHash, summary)
6. VERIFY    AgentChainArbiter.checkObligation() — 3-layer verification
7. SETTLE    User calls settleAndRate() → fees distributed + reputation updated
```

## Integration Tests

Two end-to-end tests on Base mainnet fork demonstrate the complete protocol:

**Flow A (`test_fullMainnetFlow`):**
- User registers task with 200 USDC feePool
- Orchestrator claims task
- Real EIP-712 delegation signed → redeemed via `DelegationManager.redeemDelegations()`
- AgentCapabilityEnforcer hooks fire during redemption
- Real Uniswap V3 swap executes: 0.002 WETH → 4.30 USDC
- Work records submitted → 3-layer verification passes
- Settlement: SwapAgent receives 80 USDC, orchestrator keeps 120 USDC margin

**Flow B (`test_fullMainnetFlowB`):**
- Multi-agent delegation: orchestrator delegates to PriceAgent AND SwapAgent
- PriceAgent delegation with no-op execution (read-only work)
- SwapAgent delegation with real Uniswap V3 swap
- Delegation revocation detection (Layer 1 of arbiter verification)
- Multi-agent fee distribution: PriceAgent 20 USDC + SwapAgent 80 USDC + Orchestrator 200 USDC
- ERC-8004 reputation rating (4.0 stars)

## Live Demo — Base Sepolia (On-Chain Proof)

Full autonomous execution on Base Sepolia — user posts intent, agents coordinate, real Uniswap swap + LP mint executed.

**User Intent:** `"Invest 0.01 ETH in the best Uniswap ETH/USDC LP pool"`

| Step | Action | Tx Hash | Block Explorer |
|------|--------|---------|----------------|
| 1. Register Task | EOA calls `registerTask()` on DelegationTracker with 0.5 USDC feePool | `0x2b484c3e...` | [View on BaseScan](https://sepolia.basescan.org/tx/0x2b484c3e2f4f4ddf02317828c26bc892df840f46773ff74c393e8da8e0763f45) |
| 2. LPAgent Orchestration | Receives task via HTTP, analyzes all 3 WETH/USDC fee tiers, selects 3000bp pool (deepest liquidity at 1.396e13) | — | On-chain pool reads |
| 3. Trading API Calls | `/check_approval` for WETH + USDC (success), `/quote` (no quotes — expected), `/lp/create_position` (forbidden — expected). API key usage logged. | — | Uniswap API |
| 4. SwapAgent Swap | Batched UserOp: wrap ETH → approve WETH → `exactInputSingle` on SwapRouter02. 0.005 ETH → USDC. | `0x9d62c62f...` | [View on BaseScan](https://sepolia.basescan.org/tx/0x9d62c62ff828abaac6df9d45f04dc57d1782dc80a0a0203bc1e73f6c64c517aa) |
| 5. LP Mint | Batched UserOp: wrap ETH → approve WETH → approve USDC → `NonfungiblePositionManager.mint()`. Tick range 217260–219240 (±10%). | `0x7f8943fa...` | [View on BaseScan](https://sepolia.basescan.org/tx/0x7f8943fa61c60e562005354e1a6470017fd1d71d9eab5dca9f1d25c7d55ed82f) |

| 6. Claim Task | LPAgent calls `claimTask()` on DelegationTracker — becomes orchestrator | `0xd636d9...` | [View on BaseScan](https://sepolia.basescan.org/tx/0xd636d9) |
| 7. Work Record | LPAgent calls `submitWorkRecord()` with LP tx hash as proof (batched with claim) | same UserOp | — |
| 8. Settlement | EOA calls `settleAndRate(taskId, 50)` — 5-star rating, feePool distributed, ERC-8004 reputation recorded | `0x9517cafa...` | [View on BaseScan](https://sepolia.basescan.org/tx/0x9517cafa31893beffe0753af0f25764136a722db16b187a884bd7f5bf5f7daf2) |

**Key facts:**
- Complete on-chain lifecycle executed: register → claim → delegate → swap → mint → work record → settle
- All agent transactions via ERC-4337 UserOperations through Pimlico bundler
- SwapAgent and LPAgent operated as autonomous Claude Code sessions — no human in the execution loop
- Uniswap Trading API called on every operation (API-first strategy) before falling back to direct contracts
- Real WETH/USDC swapped on Uniswap V3 SwapRouter02 against pool with verified on-chain liquidity
- Real LP position minted via NonfungiblePositionManager with computed tick ranges
- Fee pool distributed and ERC-8004 reputation feedback submitted on-chain
- Task ID: `0xadc54c875b24751559b063e70ad85b570274eac3c1566040b3e1d9217db79067`

## Project Structure

```
synthesis/
├── contracts/                    # Foundry project (Solidity ^0.8.24)
│   ├── src/
│   │   ├── AgentRegistry.sol            # Agent identity + staking
│   │   ├── DelegationTracker.sol        # Task lifecycle + fee distribution
│   │   ├── AgentCapabilityEnforcer.sol  # MetaMask CaveatEnforcer (0.8.23)
│   │   ├── AgentChainArbiter.sol        # Alkahest IArbiter + 3-layer verification
│   │   ├── interfaces/                  # IAlkahestEscrow, IArbiter, ICommon
│   │   └── libraries/                   # CustomRevert, Lock (transient storage)
│   ├── test/                            # 85 tests, 5 suites
│   │   ├── Integration.t.sol            # E2E on Base mainnet fork
│   │   ├── AgentRegistry.t.sol          # 23 tests
│   │   ├── DelegationTracker.t.sol      # 27 tests
│   │   ├── AgentChainArbiter.t.sol      # 21 tests
│   │   └── AgentCapabilityEnforcer.t.sol # 12 tests
│   └── script/                          # Deploy.s.sol, DeployAgents.s.sol
├── sdk/                          # @agentchain/sdk (TypeScript)
│   └── src/
│       ├── client.ts                    # Smart account + bundler client
│       ├── core/                        # registry, tracker, delegation, escrow, etc.
│       └── types/                       # AgentChainConfig, Task, AgentTerms, etc.
├── agents/uniswap/               # Uniswap specialist agents
│   ├── shared/                          # Protocol reference + HTTP server base
│   ├── lp-agent/                        # Orchestrator: SKILL.md + server.ts
│   ├── swap-agent/                      # Worker: SKILL.md + server.ts
│   ├── price-agent/                     # Worker: SKILL.md
│   └── hooks-agent/                     # Worker: SKILL.md
├── demo/                         # Live demo scripts (Base Sepolia)
│   ├── fund-and-register.ts             # Deploy SAs, register ERC-8004, register agents
│   ├── submit-intent.ts                 # Post user intent → trigger agent flow
│   └── deployed-addresses.json          # All on-chain addresses
└── docs/
    └── smart-contracts.md               # Canonical Solidity reference
```

## Running the Demo

### Prerequisites

- Node.js >= 18
- Foundry (for contract tests)
- Base Sepolia ETH + USDC on the EOA

### 1. Setup — Fund & Register Agents

```bash
cd demo
npm install
npx tsx fund-and-register.ts
```

This deploys smart accounts via MetaMask Smart Accounts Kit, registers ERC-8004 identities, and registers agents on AgentRegistry — all through UserOperations on Base Sepolia.

### 2. Start Agent Servers

```bash
# Terminal 1: SwapAgent
cd agents/uniswap && npx tsx swap-agent/server.ts

# Terminal 2: LPAgent (Orchestrator)
cd agents/uniswap && npx tsx lp-agent/server.ts
```

### 3. Submit Intent

```bash
# Terminal 3
cd demo && npx tsx submit-intent.ts "Invest 0.01 ETH in Uniswap LP"
```

### 4. Run Integration Tests

```bash
cd contracts
BASE_RPC_URL=https://mainnet.base.org forge test --match-test test_fullMainnetFlow -vv
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.24, Foundry |
| Account Abstraction | MetaMask HybridDeleGator, ERC-4337, EntryPoint v0.7 |
| Smart Account Management | @metamask/smart-accounts-kit, SimpleFactory CREATE2 |
| Delegation | MetaMask Delegation Framework v1.3.0, CaveatEnforcer |
| Identity | ERC-8004 IdentityRegistry + ReputationRegistry |
| Escrow | Alkahest ERC20EscrowObligation, custom IArbiter |
| Attestations | EAS (Ethereum Attestation Service) |
| Naming | ENS — human-readable agent identity (`linkENSName`) |
| Agent Marketplace | Olas Mech Marketplace — cross-network agent discovery |
| DEX | Uniswap V3 (Trading API, SwapRouter02, V3Factory, NonfungiblePositionManager) |
| Uniswap AI | Uniswap AI Skills (`swap-integration`) |
| Token Approval | Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) |
| SDK | TypeScript, viem, viem/account-abstraction |
| Agent Runtime | Claude Code with SKILL.md |
| Agent Harness | Claude Code (Anthropic CLI) |
| Bundler | Pimlico public bundler (Base Sepolia) |
| Chain | Base Sepolia (testnet), Base (production target) |

## License

MIT
