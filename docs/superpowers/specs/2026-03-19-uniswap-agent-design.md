# UniAgent — Uniswap Agent Design Spec

**Created:** 2026-03-19
**Status:** Reviewed
**Scope:** `agents/uniswap/` — standalone TypeScript package

## 1. Overview

UniAgent is a full-stack Uniswap specialist agent that participates in the AgentChain network. It has its own ERC-4337 smart account (HybridDeleGator via MetaMask SimpleFactory), registers with ERC-8004 identity, and operates as both a **worker** (receives delegated swap/LP tasks) and an **orchestrator** (decomposes complex intents and delegates sub-tasks to other agents).

### What It Masters

- Token swaps via Uniswap Trading API (classic + UniswapX gasless)
- Liquidity management on V3 and V4 (concentrated liquidity positions)
- Custom V4 hook interaction
- Intent decomposition and delegation to specialist agents

### Bounty Alignment

| Requirement | How We Meet It |
|---|---|
| Real Uniswap API key | Every swap/quote goes through Trading API with `x-api-key` header |
| Real TxIDs on mainnet | Swaps, LP positions, gasless orders — all on Base (chain 8453) |
| Depth in Uniswap stack | Trading API + UniswapX + V3 LP + V4 LP + V4 Hooks + Permit2 |
| Agentic finance | Autonomous execution, smart routing, delegation to other agents |

## 2. Agent Identity & Registration

UniAgent uses the existing `@agentchain/sdk` for all on-chain identity and delegation infrastructure.

### Lifecycle

```typescript
// 1. Generate EOA private key (from config / vault)
const signer = privateKeyToAccount(config.privateKey);

// 2. Deploy smart account via SDK
const { address: smartAccount } = await sdk.accounts.createAgentAccount({
  signer,
  salt: 0n,
});
// → SimpleFactory.deploy() via CREATE2
// → HybridDeleGator smart account deployed on Base

// 3. Approve USDC for staking (prerequisite)
await approveUSDC(smartAccount, agentRegistryAddress, config.stakeAmount);

// 4. Register in AgentChain via SDK
await sdk.registry.registerAndStake({
  name: config.name,
  erc8004Id: config.erc8004Id,
  capabilities: [
    'uniswap-swap', 'uniswap-gasless', 'uniswap-quote',
    'uniswap-lp-v3', 'uniswap-lp-v4', 'uniswap-hooks',
    'defi-orchestrator',
  ],
  endpoint: config.endpoint,
  stakeAmount: config.stakeAmount,
});

// 5. UniAgent is live — discoverable, delegatable, reputable
```

### Smart Account Capabilities (HybridDeleGator / ERC-4337)

- Submit UserOperations via bundlers
- Receive AND create MetaMask delegations
- Batched calls (multi-step DeFi in one tx)
- Deterministic address via CREATE2 (predictable before deployment)

### Execution Model

UniAgent's smart account (HybridDeleGator) executes transactions via the **EOA signer calling through the smart account**. The EOA signs transactions on behalf of the smart account. For the hackathon, we use direct EOA execution rather than a bundler to reduce complexity. The smart account is required for delegation compatibility (DelegationManager calls `executeFromExecutor()` on it).

### Gas Funding

The smart account must hold ETH for gas on classic swaps and LP operations. During setup, the agent funds its smart account with ETH from the EOA signer:

```typescript
await walletClient.sendTransaction({
  to: smartAccount,
  value: parseEther('0.05'), // enough for ~50 transactions on Base
});
```

### Permit2 Flow

The Uniswap Trading API returns `permitData` in the quote response when Permit2 approval is needed. Since UniAgent uses a smart account (not a plain EOA), Permit2 signatures use **EIP-1271** (contract signature verification):

```
1. POST /quote → response includes permitData
2. Smart account signs the permit via EIP-1271 (signMessage on EOA, verified by HybridDeleGator)
3. Signed permit is included in POST /swap or POST /order request
```

Permit2 contract on Base: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

### Registered Capabilities

```
"uniswap-swap"        → Execute token swaps (V2/V3/V4 via Trading API)
"uniswap-gasless"     → Submit UniswapX gasless orders (Dutch auctions)
"uniswap-quote"       → Get best-route quotes across all pools
"uniswap-lp-v3"       → Manage V3 concentrated liquidity positions
"uniswap-lp-v4"       → Manage V4 concentrated liquidity + hook interaction
"uniswap-hooks"       → Interact with custom V4 hooks
"defi-orchestrator"   → Decompose intents and delegate sub-tasks
```

## 3. Swap + Gasless Capability (Trading API)

### API Integration

- **Base URL:** `https://trade-api.gateway.uniswap.org/v1`
- **Auth:** `x-api-key: UNISWAP_API_KEY` header on every request
- **Chain:** Base (8453)

### Three-Step Swap Flow

```
Step 1: POST /check_approval
  → Is Permit2 approved for this token?
  → If not: returns approval tx to sign

Step 2: POST /quote
  Request:
  {
    tokenIn: address,
    tokenOut: address,
    tokenInChainId: 8453,
    tokenOutChainId: 8453,
    amount: string (wei),
    type: "EXACT_INPUT" | "EXACT_OUTPUT",
    swapper: smartAccountAddress,
    slippageTolerance: 0.5
  }

  Response includes:
  → routing: "CLASSIC" | "DUTCH_V2" | "WRAP" | "UNWRAP"
  → quote: price, route, gas estimate
  → permitData: Permit2 signature data (nullable)

Step 3: Execute based on routing type
  CLASSIC → POST /swap → returns unsigned tx → sign + broadcast → TxID
  DUTCH_V2 → POST /order → gasless UniswapX → market maker fills → orderId
```

### Smart Routing Logic

```typescript
async executeSwapIntent(params: SwapParams): Promise<SwapResult> {
  const approval = await this.checkApproval(params.tokenIn, params.amount);
  if (approval.needed) await this.signApprovalTx(approval.tx);

  const quote = await this.getQuote(params);

  if (quote.routing === 'DUTCH_V2' || quote.routing === 'DUTCH_V3') {
    // Gasless: market maker fills, user pays zero gas
    // Only if amount >= 1000 USDC equivalent on L2
    return await this.submitGaslessOrder(quote);
  } else {
    // Classic: on-chain via AMM pools, agent pays gas
    return await this.executeClassicSwap(quote);
  }
}
```

### Status Tracking

- Classic swaps: `GET /swaps?transactionHashes={txHash}&chainId=8453`
- UniswapX orders: `GET /orders?orderId={orderId}`
- Agent retries with classic if UniswapX order expires unfilled

## 4. LP Management (V3 + V4 + Custom Hooks)

### V3 vs V4 Differences

| Aspect | V3 | V4 |
|---|---|---|
| Contract | NonfungiblePositionManager | PoolManager (singleton) |
| Position tracking | NFT (ERC-721) | Internal accounting |
| Pool deployment | Separate contract per pool | All pools in one contract |
| Hooks | None | Full lifecycle hooks |
| Add liquidity | `mint()` | `modifyLiquidity()` |
| Core math | Ticks + concentrated ranges | Same ticks + concentrated ranges |

### LP Lifecycle

```
1. ANALYZE  → Query pool state (price, tick, TVL, volume, fee tier)
2. COMPUTE  → Calculate optimal tick range based on strategy
3. PREPARE  → Swap to get both tokens if needed (via SwapModule)
4. ADD      → Mint position (V3 NFT or V4 internal)
5. MONITOR  → Watch if position goes out of range
6. REBALANCE → Remove + re-add in new range (if configured)
7. REMOVE   → Exit position, collect accumulated fees
```

### Token Preparation Logic

Before adding liquidity, the agent must ensure it holds both pool tokens in the right ratio. Three scenarios:

```
Scenario 1: User holds Token A, wants LP in A/B pool
  → Swap 50% of A → B (1 swap)
  → Add liquidity with A + B

Scenario 2: User holds Token C, wants LP in A/B pool (C is neither A nor B)
  → Swap 50% of C → A (swap #1)
  → Swap 50% of C → B (swap #2)
  → Add liquidity with A + B

Scenario 3: User holds Token A, wants LP in A/B pool, but wrong ratio
  → Compute exact amounts needed for the tick range
  → Swap only the excess A → B
  → Add liquidity with balanced A + B
```

### Batched Execution via Smart Account

Since UniAgent uses a HybridDeleGator (ERC-4337 smart account), all token preparation and LP operations are **batched into a single atomic transaction**:

```
Single Tx (batched via smart account):
  call[0]: Swap ETH → USDC (via Universal Router)
  call[1]: Swap ETH → USDT (via Universal Router)
  call[2]: Approve USDC to PositionManager
  call[3]: Approve USDT to PositionManager
  call[4]: Add USDC/USDT LP position
= 1 transaction, 1 TxID, atomic (all succeed or all revert)
```

**Benefits over sequential transactions:**
- **Cheaper** — one base gas cost instead of N
- **Atomic** — no partial state if a step fails mid-way
- **Simpler** — one TxID captures the entire operation
- **No nonce management** — single tx, single nonce

```typescript
async prepareAndAddLiquidity(params: {
  inputToken: Address,
  inputAmount: bigint,
  tokenA: Address,
  tokenB: Address,
  tickLower: number,
  tickUpper: number,
  feeTier: number,
  version: 'v3' | 'v4',
}): Promise<{ txHash: Hex }> {
  const calls: BatchCall[] = [];

  if (params.inputToken !== params.tokenA && params.inputToken !== params.tokenB) {
    // Scenario 2: input is NEITHER pool token → batch two swaps
    const halfAmount = params.inputAmount / 2n;
    calls.push(
      buildSwapCall(params.inputToken, params.tokenA, halfAmount),
      buildSwapCall(params.inputToken, params.tokenB, params.inputAmount - halfAmount),
    );
  } else {
    // Scenario 1: input is one of the pool tokens → batch one swap
    const otherToken = params.inputToken === params.tokenA ? params.tokenB : params.tokenA;
    calls.push(
      buildSwapCall(params.inputToken, otherToken, params.inputAmount / 2n),
    );
  }

  // Add approvals + LP mint to the same batch
  calls.push(
    buildApproveCall(params.tokenA, positionManager),
    buildApproveCall(params.tokenB, positionManager),
    buildAddLiquidityCall(params),
  );

  // Execute all calls as a single atomic transaction via smart account
  const txHash = await this.executeBatch(calls);
  return { txHash };
}

// Uses HybridDeleGator's batch execution capability
private async executeBatch(calls: BatchCall[]): Promise<Hex> {
  const hash = await walletClient.sendTransaction({
    to: smartAccountAddress,
    data: encodeBatchExecution(calls),  // ERC-4337 batch encoding
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}
```

For **simple swaps** (no LP), the agent still uses individual Trading API calls since those go through Uniswap's routing optimization. Batching is used when we need **multiple on-chain operations** that are sequential and dependent (swap → approve → LP).

### Range Strategies

```
tight:     ±5% from current price  → more fees, more IL risk
moderate:  ±10% from current price → balanced
wide:      ±20% from current price → less fees, safer
```

### V4 Hook Interaction

UniAgent can interact with any deployed V4 hook:

```typescript
// Detect hook on a V4 pool
const poolState = await liquidity.analyzePool({
  tokenA: WETH,
  tokenB: USDC,
  feeTier: 3000,
  version: 'v4',
  hookAddress: '0x...'
});

// Read hook-specific state (e.g., dynamic fee hook)
const hookData = await liquidity.interactWithHook({
  hookAddress: poolState.hookAddress,
  hookAbi: customHookAbi,
  functionName: 'getCurrentFee',
  args: [poolState.poolId]
});

// Add liquidity to hooked pool
const result = await liquidity.addLiquidityV4({
  poolKey: poolState.poolKey,  // includes hook address
  tickLower: range.tickLower,
  tickUpper: range.tickUpper,
  amount: parseEther('1'),
  hookData: '0x'  // optional data passed to hook's beforeAddLiquidity
});
```

### Uniswap Contract Addresses (Base)

```
# V3
NonfungiblePositionManager: 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1
SwapRouter02:               0x2626664c2603336E57B271c5C0b26F421741e481
UniswapV3Factory:           0x33128a8fC17869897dcE68Ed026d694621f6FDfD

# V4
PoolManager:                0x7Da1D65F8B249183667cdE74C5CBD46dU40CB45
PositionManager:            0xbD216513d74C8cf14cf4747A28b43bEb3Ce875b

# Shared
Permit2:                    0x000000000022D473030F116dDEE9F6B43aC78BA3
WETH:                       0x4200000000000000000000000000000000000006
USDC:                       0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

Note: V4 addresses should be verified against latest Uniswap deployments before implementation.

## 5. Orchestration + Delegation

When UniAgent receives a complex intent, it decomposes into sub-tasks — executes Uniswap operations itself and delegates the rest.

### Intent Decomposition

```
Intent: "Put 5 ETH to work for best yield on Uniswap"

UniAgent decomposes:
  ├─► DELEGATE: "Get ETH price from multiple sources"
  │     → Discover agent with "price-feed" capability
  │     → MetaMask delegation: budget 2 USDC, expiry 1hr
  │
  ├─► DELEGATE: "Get pool analytics — APYs, TVL, volume"
  │     → Discover agent with "pool-analytics" capability
  │     → MetaMask delegation: budget 3 USDC, expiry 1hr
  │
  ├─► SELF: Compute optimal LP range from returned data
  │
  ├─► SELF: Swap 2.5 ETH → USDC (Trading API)
  │
  └─► SELF: Add ETH/USDC LP position (V3 or V4)
```

### Delegation Flow

```typescript
async delegateTask(params: DelegateParams): Promise<DelegationResult> {
  // 1. Discover agents with required capability (params object)
  const agents = await this.sdk.discovery.discover({
    capability: params.capability,
    minReputation: this.config.minSubAgentReputation,
    minStake: params.minStake,
  });

  // 2. Select best agent (highest reputation, adequate stake)
  const bestAgent = selectBestAgent(agents);

  // 3. Create MetaMask delegation with caveats (all fields required by SDK)
  const delegation = await this.sdk.delegation.createDelegation({
    to: bestAgent.address,
    taskId: params.taskId,
    budget: params.budget,
    targets: params.targets,              // allowed contract addresses
    methods: params.methods,              // allowed function selectors
    requiredCaps: [params.capability],
    fee: params.budget,
    minStake: params.minStake ?? 0n,
    maxDepth: 2,
    currentDepth: 1,
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });

  return { agent: bestAgent, delegation };
}
```

### On-Chain Delegation Validation

When a sub-agent redeems a delegation from UniAgent:

```
1. DelegationManager.redeemDelegations() called by sub-agent
2. Validates delegation chain (signatures, authority)
3. AgentCapabilityEnforcer.beforeHook():
   → Sub-agent registered in AgentChain? ✓
   → Sub-agent stake >= minStake? ✓
   → Sub-agent has required capability? ✓
   → Delegation depth < maxDepth? ✓
4. Action executes via UniAgent's smart account
5. AgentCapabilityEnforcer.afterHook():
   → Records delegation hop in DelegationTracker
   → Records promised fee for settlement
```

### Intent Types

| Intent | Self-Execute | Delegates To |
|---|---|---|
| "Swap X to Y" | SwapModule | — |
| "Best price for ETH/USDC" | QuoteModule | — |
| "Add LP in ETH/USDC" | LiquidityModule | — |
| "Maximize yield with 5 ETH" | Swap + LP | PricingAgent, AnalyticsAgent |
| "Rebalance portfolio to 60/40" | Swap | PricingAgent |
| "DCA 1000 USDC into ETH over 5 days" | Swap (repeated) | — |

## 6. Package Structure

```
agents/
└── uniswap/
    ├── src/
    │   ├── index.ts           — UniAgent class (entry point, lifecycle)
    │   ├── swap.ts            — SwapModule (Trading API + UniswapX)
    │   ├── liquidity.ts       — LiquidityModule (V3 + V4 + hooks)
    │   ├── quotes.ts          — QuoteModule (price queries, route analysis)
    │   ├── orchestrator.ts    — OrchestratorModule (intent decomposition, delegation)
    │   └── types.ts           — Uniswap-specific types
    ├── test/
    │   ├── swap.test.ts
    │   ├── liquidity.test.ts
    │   ├── quotes.test.ts
    │   └── orchestrator.test.ts
    ├── package.json           — depends on @agentchain/sdk, viem
    └── tsconfig.json
```

### Dependencies

```json
{
  "name": "@agentchain/uniswap-agent",
  "dependencies": {
    "@agentchain/sdk": "workspace:*",
    "viem": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^1.0.0"
  }
}
```

### Module Interfaces

```typescript
// SwapModule
class SwapModule {
  checkApproval(token: Address, amount: bigint): Promise<ApprovalResult>
  getQuote(params: SwapParams): Promise<QuoteResult>
  executeSwap(quote: QuoteResult): Promise<{ txHash: Hex }>
  submitGaslessOrder(quote: QuoteResult): Promise<{ orderId: string }>
  getSwapStatus(txHash: Hex): Promise<SwapStatus>
  getOrderStatus(orderId: string): Promise<OrderStatus>
}

// LiquidityModule
class LiquidityModule {
  analyzePool(params: PoolQuery): Promise<PoolState>
  computeOptimalRange(pool: PoolState, strategy: Strategy): Promise<TickRange>
  addLiquidityV3(params: AddLiquidityV3Params): Promise<{ tokenId: bigint, txHash: Hex }>
  addLiquidityV4(params: AddLiquidityV4Params): Promise<{ txHash: Hex }>
  removeLiquidityV3(tokenId: bigint): Promise<{ txHash: Hex }>
  removeLiquidityV4(params: RemoveLiquidityV4Params): Promise<{ txHash: Hex }>
  collectFeesV3(tokenId: bigint): Promise<{ txHash: Hex, amount0: bigint, amount1: bigint }>
  interactWithHook(params: HookInteractionParams): Promise<{ txHash: Hex }>
  addLiquidity(params: AddLiquidityParams): Promise<LPResult>  // version-agnostic
  removeLiquidity(params: RemoveLiquidityParams): Promise<{ txHash: Hex }>  // version-agnostic
}

// QuoteModule
class QuoteModule {
  getQuote(params: QuoteParams): Promise<QuoteResult>
  getMultipleQuotes(params: QuoteParams[]): Promise<QuoteResult[]>
  getBestRoute(tokenIn: Address, tokenOut: Address, amount: bigint): Promise<RouteInfo>
}

// OrchestratorModule
class OrchestratorModule {
  decomposeIntent(intent: Intent): Promise<TaskPlan>
  delegateTask(params: DelegateParams): Promise<DelegationResult>
  executePlan(plan: TaskPlan): Promise<ExecutionResult>
}
```

## 7. Data Flow: End-to-End

### Simple Swap

```
User/Agent posts intent: "Swap 1 ETH to USDC"
    │
    ▼
AgentChain (on-chain):
  1. Task registered in DelegationTracker
  2. UniAgent discovered (has "uniswap-swap")
  3. Delegation created → UniAgent
  4. AgentCapabilityEnforcer validates UniAgent
    │
    ▼
UniAgent (off-chain):
  5. handleIntent() → simple swap, no delegation needed
  6. POST /check_approval → approve if needed
  7. POST /quote → get routing + price
  8. POST /swap or /order → execute
  9. sdk.tracker.submitWorkRecord(taskId, resultHash, summary)
    │
    ▼
Settlement (on-chain):
  10. Arbiter verifies delegation chain
  11. Fee distributed from orchestrator's stake
  12. ERC-8004 reputation updated
```

### Complex Intent (LP + Delegation)

```
Intent: "Put 5 ETH to work for best yield"
    │
    ▼
UniAgent (orchestrator mode):
  Phase 1 — RESEARCH (delegated):
    → Discover "price-feed" agent → delegate
    → Discover "pool-analytics" agent → delegate
    → Wait for work records from both

  Phase 2 — DECIDE (self):
    → Read sub-agent results
    → Compare pool APYs
    → Pick range strategy
    → Decide allocation

  Phase 3 — EXECUTE (self):
    → swap.executeSwap(2.5 ETH → USDC)      → TxID #1
    → liquidity.addLiquidity(ETH/USDC, range) → TxID #2
    → tracker.submitWorkRecord(taskId, proof)
```

## 8. Configuration

```typescript
interface UniAgentConfig {
  // AgentChain connection
  chain: 'base' | 'baseSepolia';
  rpcUrl: string;
  privateKey: Hex;             // agent's EOA signer
  stakeAmount: bigint;         // USDC to stake in AgentChain

  // Uniswap
  uniswapApiKey: string;       // from Uniswap Developer Platform
  defaultSlippage: number;     // default slippage tolerance (e.g., 0.5 for 0.5%)
  maxSlippage: number;         // max slippage for retries (e.g., 2.0 for 2%)

  // Agent identity
  name: string;                // e.g., "UniAgent"
  endpoint: string;            // HTTP URL where agent receives task notifications
  erc8004Id: bigint;           // pre-registered ERC-8004 identity NFT

  // Orchestration
  maxDelegationBudget: bigint; // max USDC to spend per delegation
  minSubAgentReputation: number; // minimum ERC-8004 reputation for discovered agents
}
```

### Config to SDK Mapping

```typescript
// UniAgentConfig feeds into AgentChain.create()
const sdk = AgentChain.create({
  chain: config.chain,
  rpcUrl: config.rpcUrl,
  privateKey: config.privateKey,
  // contracts: optional overrides for deployed addresses
});

// Then registration uses SDK methods:
await sdk.registry.registerAndStake({
  name: config.name,
  erc8004Id: config.erc8004Id,
  capabilities: [...],
  endpoint: config.endpoint,
  stakeAmount: config.stakeAmount,
});
```

### Environment Variables

```
UNISWAP_API_KEY=           # Uniswap Developer Platform API key
AGENT_PRIVATE_KEY=         # EOA private key for the agent
BASE_RPC_URL=              # Base mainnet RPC endpoint
ERC8004_ID=                # Pre-registered ERC-8004 identity token ID
STAKE_AMOUNT=              # USDC stake amount (6 decimals)
AGENT_ENDPOINT=            # HTTP URL for task notifications
DEFAULT_SLIPPAGE=0.5       # Default slippage tolerance (%)
MAX_SLIPPAGE=2.0           # Max slippage for retries (%)
```

### Task Processing Model

UniAgent processes tasks **sequentially** (one at a time) to avoid nonce conflicts on the smart account. A simple queue holds incoming tasks:

```
Task arrives → enqueue → process front of queue → dequeue → next
```

This is sufficient for hackathon demo. Production would use nonce management with concurrent processing.

## 9. Error Handling

| Error | Response |
|---|---|
| Quote expired (>30s) | Re-fetch quote automatically |
| Swap reverted on-chain | Return error in work record, do not submit as success |
| UniswapX order not filled | Fall back to classic swap via POST /swap |
| No agents found for delegation | Execute without delegation if possible, else fail task |
| LP position out of range | Emit event, rebalance if configured |
| API rate limited (429) | Exponential backoff, retry up to 3 times |
| Insufficient approval | Auto-approve via Permit2 |
| Slippage exceeded | Re-quote with wider tolerance (up to max), else fail |

## 10. Testing Strategy

### Unit Tests

- `swap.test.ts` — Quote encoding, routing decision logic, API response parsing
- `liquidity.test.ts` — Tick range computation, V3/V4 parameter encoding
- `quotes.test.ts` — Route comparison, best-route selection
- `orchestrator.test.ts` — Intent decomposition, agent selection logic

### Integration Tests (require API key)

- Execute real swap on Base (small amount)
- Execute gasless UniswapX order
- Create V3 LP position
- Full orchestration flow with mock sub-agents

### Orchestration Testing

For demo purposes, register **mock sub-agents** (simple scripts that register with capabilities like `"price-feed"` and `"pool-analytics"`, accept delegations, and return hardcoded but realistic data). These mock agents demonstrate the delegation flow without building full specialist agents.

## 11. Demo Flow

The demo script (`demo/uniswap-demo.ts`) showcases both capabilities:

### Demo A: Swap + Gasless

```
1. Register UniAgent in AgentChain (ERC-4337 smart account + ERC-8004)
2. User posts intent: "Swap 0.01 ETH to USDC"
3. UniAgent claims task
4. UniAgent queries Trading API → gets CLASSIC or DUTCH_V2 routing
5. UniAgent executes swap → real TxID on Base
6. UniAgent submits work record
7. Settlement: fee distributed, reputation updated
```

### Demo B: LP Management

```
1. User posts intent: "Provide liquidity with 0.02 ETH in ETH/USDC"
2. UniAgent claims task
3. UniAgent analyzes V3 + V4 pools, picks best
4. UniAgent swaps half to USDC → TxID #1
5. UniAgent adds LP position → TxID #2
6. UniAgent submits work record with position details
7. Settlement: fee distributed, reputation updated
```

### On-Chain Artifacts Generated

- Agent registration tx
- ERC-8004 identity registration
- USDC stake tx
- Task registration
- Delegation creation
- Uniswap swap TxIDs
- LP position TxIDs / NFT
- Work record submissions
- Settlement + reputation feedback
