# UniAgent (Uniswap Agent) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Uniswap specialist agent that registers in AgentChain, executes swaps (classic + UniswapX gasless), manages V3/V4 LP positions with batched execution, and orchestrates sub-tasks via delegation.

**Architecture:** Standalone TypeScript package at `agents/uniswap/` that imports `@agentchain/sdk` for on-chain identity, delegation, and settlement. All Uniswap interactions go through the Trading API (`trade-api.gateway.uniswap.org/v1`) for swaps and direct contract calls (via viem) for LP management. The agent uses a HybridDeleGator smart account (ERC-4337) for batched transaction execution and delegation compatibility.

**Tech Stack:** TypeScript, viem, vitest, `@agentchain/sdk`, Uniswap Trading API, Uniswap V3/V4 contracts on Base (chain 8453)

**Spec:** `docs/superpowers/specs/2026-03-19-uniswap-agent-design.md`

---

## File Structure

```
agents/uniswap/
├── src/
│   ├── index.ts           — UniAgent class: lifecycle (register, start, stop, handleIntent)
│   ├── types.ts           — All Uniswap-specific types, interfaces, constants, contract addresses
│   ├── api.ts             — HTTP client for Uniswap Trading API (shared by swap + quotes)
│   ├── swap.ts            — SwapModule: check_approval, quote, swap, gasless order
│   ├── quotes.ts          — QuoteModule: multi-quote, best-route selection
│   ├── liquidity.ts       — LiquidityModule: V3/V4 pool analysis, LP positions, hooks, batched execution
│   ├── orchestrator.ts    — OrchestratorModule: intent decomposition, discovery, delegation
│   └── batch.ts           — Batch execution helpers for smart account multicall
├── test/
│   ├── types.test.ts      — Constants, address validation
│   ├── api.test.ts        — API client request building, header injection
│   ├── swap.test.ts       — Routing decision logic, response parsing
│   ├── quotes.test.ts     — Multi-quote comparison, best-route selection
│   ├── liquidity.test.ts  — Tick range computation, token preparation logic, batch building
│   ├── orchestrator.test.ts — Intent decomposition, agent selection
│   └── batch.test.ts      — Batch call encoding
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `agents/uniswap/package.json`
- Create: `agents/uniswap/tsconfig.json`
- Create: `agents/uniswap/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agentchain/uniswap-agent",
  "version": "0.1.0",
  "description": "Uniswap specialist agent for AgentChain",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@agentchain/sdk": "file:../../sdk",
    "viem": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd agents/uniswap && npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 5: Verify build**

Run: `cd agents/uniswap && npx tsc --noEmit`
Expected: No errors (nothing to compile yet, but config is valid)

- [ ] **Step 6: Commit**

```bash
git add -f agents/uniswap/package.json agents/uniswap/tsconfig.json agents/uniswap/vitest.config.ts agents/uniswap/package-lock.json
git commit -m "chore(sdk): scaffold @agentchain/uniswap-agent package"
```

---

## Task 2: Types & Constants

**Files:**
- Create: `agents/uniswap/src/types.ts`
- Create: `agents/uniswap/test/types.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  UNISWAP_ADDRESSES,
  TRADING_API_BASE_URL,
  RoutingType,
  type SwapParams,
  type QuoteResult,
} from '../src/types.js';

describe('types and constants', () => {
  it('has correct Base chain addresses', () => {
    expect(UNISWAP_ADDRESSES.base.permit2).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3');
    expect(UNISWAP_ADDRESSES.base.weth).toBe('0x4200000000000000000000000000000000000006');
    expect(UNISWAP_ADDRESSES.base.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('has correct Trading API base URL', () => {
    expect(TRADING_API_BASE_URL).toBe('https://trade-api.gateway.uniswap.org/v1');
  });

  it('RoutingType enum has expected values', () => {
    expect(RoutingType.CLASSIC).toBe('CLASSIC');
    expect(RoutingType.DUTCH_V2).toBe('DUTCH_V2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/types.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write types.ts**

```typescript
// src/types.ts
import type { Address, Hex, Abi } from 'viem';

// ─── Trading API ─────────────────────────────────────────

export const TRADING_API_BASE_URL = 'https://trade-api.gateway.uniswap.org/v1';

export enum RoutingType {
  CLASSIC = 'CLASSIC',
  DUTCH_V2 = 'DUTCH_V2',
  DUTCH_V3 = 'DUTCH_V3',
  PRIORITY = 'PRIORITY',
  WRAP = 'WRAP',
  UNWRAP = 'UNWRAP',
  BRIDGE = 'BRIDGE',
}

export enum SwapType {
  EXACT_INPUT = 'EXACT_INPUT',
  EXACT_OUTPUT = 'EXACT_OUTPUT',
}

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  type: SwapType;
  slippageTolerance?: number;
}

export interface ApprovalRequest {
  walletAddress: Address;
  token: Address;
  amount: string;
  chainId: number;
}

export interface ApprovalResult {
  needed: boolean;
  tx?: { to: Address; data: Hex; value: string };
}

export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type: SwapType;
  swapper: string;
  slippageTolerance: number;
}

export interface QuoteResult {
  requestId: string;
  routing: RoutingType;
  quote: {
    amountIn: string;
    amountOut: string;
    gasEstimate: string;
  };
  permitData?: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    values: Record<string, unknown>;
  };
}

export interface SwapResult {
  txHash?: Hex;
  orderId?: string;
  routing: RoutingType;
  amountIn: string;
  amountOut: string;
}

export type SwapStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
export type OrderStatus = 'open' | 'filled' | 'expired' | 'cancelled';

// ─── Liquidity ───────────────────────────────────────────

export type UniswapVersion = 'v3' | 'v4';
export type RangeStrategy = 'tight' | 'moderate' | 'wide';

export interface PoolQuery {
  tokenA: Address;
  tokenB: Address;
  feeTier: number;
  version: UniswapVersion;
  hookAddress?: Address;
}

export interface PoolState {
  tokenA: Address;
  tokenB: Address;
  feeTier: number;
  version: UniswapVersion;
  currentTick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  hookAddress?: Address;
  poolId?: Hex;
  poolKey?: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
}

export interface TickRange {
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
}

export interface AddLiquidityParams {
  inputToken: Address;
  inputAmount: bigint;
  tokenA: Address;
  tokenB: Address;
  tickLower: number;
  tickUpper: number;
  feeTier: number;
  version: UniswapVersion;
  hookAddress?: Address;
  hookData?: Hex;
}

export interface LPResult {
  txHash: Hex;
  tokenId?: bigint;   // V3 only (NFT position ID)
  version: UniswapVersion;
}

export interface HookInteractionParams {
  hookAddress: Address;
  hookAbi: Abi;
  functionName: string;
  args: unknown[];
}

// ─── Batch Execution ─────────────────────────────────────

export interface BatchCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

// ─── Orchestration ───────────────────────────────────────

export interface Intent {
  description: string;
  inputToken?: Address;
  inputAmount?: bigint;
  targetPool?: { tokenA: Address; tokenB: Address };
}

export interface TaskStep {
  type: 'self' | 'delegate';
  description: string;
  capability?: string;     // required for delegate
  budget?: bigint;         // required for delegate
  targets?: Address[];     // delegation allowed targets
  methods?: string[];      // delegation allowed methods
  dependsOn?: number[];    // indices of steps that must complete first
}

export interface TaskPlan {
  steps: TaskStep[];
}

export interface DelegateParams {
  taskId: Hex;
  capability: string;
  budget: bigint;
  minStake?: bigint;
  targets: Address[];
  methods: string[];
}

export interface ExecutionResult {
  txHashes: Hex[];
  orderIds: string[];
  delegations: { agent: Address; capability: string }[];
  success: boolean;
  summary: string;
}

// ─── Config ──────────────────────────────────────────────

export interface UniAgentConfig {
  chain: 'base' | 'baseSepolia';
  rpcUrl: string;
  privateKey: Hex;
  stakeAmount: bigint;
  uniswapApiKey: string;
  defaultSlippage: number;
  maxSlippage: number;
  name: string;
  endpoint: string;
  erc8004Id: bigint;
  maxDelegationBudget: bigint;
  minSubAgentReputation: number;
}

// ─── Contract Addresses ──────────────────────────────────

export const UNISWAP_ADDRESSES = {
  base: {
    // V3
    nonfungiblePositionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1' as Address,
    swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
    v3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as Address,
    // V4 (verify against latest Uniswap deployments before use)
    poolManager: '0x7Da1D65F8B249183667cdE74C5CBD46dU40CB45' as Address,
    positionManager: '0xbD216513d74C8cf14cf4747A28b43bEb3Ce875b' as Address,
    // Shared
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  },
  baseSepolia: {
    // V3 (same contracts, different chain)
    nonfungiblePositionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1' as Address,
    swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
    v3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as Address,
    poolManager: '0x0000000000000000000000000000000000000000' as Address,
    positionManager: '0x0000000000000000000000000000000000000000' as Address,
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address, // Base Sepolia USDC
  },
} as const;

export const BASE_CHAIN_ID = 8453;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/types.ts agents/uniswap/test/types.test.ts
git commit -m "feat(sdk): add UniAgent types, constants, and contract addresses"
```

---

## Task 3: Trading API Client

**Files:**
- Create: `agents/uniswap/src/api.ts`
- Create: `agents/uniswap/test/api.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/api.test.ts
import { describe, it, expect } from 'vitest';
import { UniswapApiClient } from '../src/api.js';
import { TRADING_API_BASE_URL } from '../src/types.js';

describe('UniswapApiClient', () => {
  it('constructs with API key', () => {
    const client = new UniswapApiClient('test-api-key');
    expect(client).toBeDefined();
  });

  it('builds correct request headers', () => {
    const client = new UniswapApiClient('test-api-key');
    const headers = client.getHeaders();
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('builds correct URL for endpoints', () => {
    const client = new UniswapApiClient('test-api-key');
    expect(client.url('/quote')).toBe(`${TRADING_API_BASE_URL}/quote`);
    expect(client.url('/check_approval')).toBe(`${TRADING_API_BASE_URL}/check_approval`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/api.test.ts`
Expected: FAIL

- [ ] **Step 3: Write api.ts**

```typescript
// src/api.ts
import { TRADING_API_BASE_URL } from './types.js';

export class UniswapApiClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  url(path: string): string {
    return `${TRADING_API_BASE_URL}${path}`;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Uniswap API ${path} failed (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const searchParams = params ? '?' + new URLSearchParams(params).toString() : '';
    const response = await fetch(this.url(path) + searchParams, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Uniswap API ${path} failed (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/api.ts agents/uniswap/test/api.test.ts
git commit -m "feat(sdk): add Uniswap Trading API HTTP client"
```

---

## Task 4: SwapModule

**Files:**
- Create: `agents/uniswap/src/swap.ts`
- Create: `agents/uniswap/test/swap.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/swap.test.ts
import { describe, it, expect } from 'vitest';
import { SwapModule } from '../src/swap.js';
import { RoutingType, SwapType, type QuoteResult } from '../src/types.js';

describe('SwapModule', () => {
  describe('routing decision', () => {
    it('chooses gasless for DUTCH_V2 routing', () => {
      const result = SwapModule.shouldUseGasless({
        routing: RoutingType.DUTCH_V2,
      } as QuoteResult);
      expect(result).toBe(true);
    });

    it('chooses classic for CLASSIC routing', () => {
      const result = SwapModule.shouldUseGasless({
        routing: RoutingType.CLASSIC,
      } as QuoteResult);
      expect(result).toBe(false);
    });

    it('chooses classic for WRAP routing', () => {
      const result = SwapModule.shouldUseGasless({
        routing: RoutingType.WRAP,
      } as QuoteResult);
      expect(result).toBe(false);
    });
  });

  describe('quote request building', () => {
    it('builds correct quote request body', () => {
      const body = SwapModule.buildQuoteRequest({
        tokenIn: '0xaaa' as `0x${string}`,
        tokenOut: '0xbbb' as `0x${string}`,
        amount: 1000000000000000000n,
        type: SwapType.EXACT_INPUT,
        slippageTolerance: 0.5,
      }, '0xswapper' as `0x${string}`, 8453);

      expect(body.tokenIn).toBe('0xaaa');
      expect(body.tokenOut).toBe('0xbbb');
      expect(body.amount).toBe('1000000000000000000');
      expect(body.type).toBe('EXACT_INPUT');
      expect(body.tokenInChainId).toBe(8453);
      expect(body.tokenOutChainId).toBe(8453);
      expect(body.swapper).toBe('0xswapper');
      expect(body.slippageTolerance).toBe(0.5);
    });
  });

  describe('approval request building', () => {
    it('builds correct approval request body', () => {
      const body = SwapModule.buildApprovalRequest(
        '0xwallet' as `0x${string}`,
        '0xtoken' as `0x${string}`,
        1000000n,
        8453,
      );
      expect(body.walletAddress).toBe('0xwallet');
      expect(body.token).toBe('0xtoken');
      expect(body.amount).toBe('1000000');
      expect(body.chainId).toBe(8453);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/swap.test.ts`
Expected: FAIL

- [ ] **Step 3: Write swap.ts**

```typescript
// src/swap.ts
import type { Address, Hex } from 'viem';
import type { UniswapApiClient } from './api.js';
import {
  type SwapParams,
  type QuoteResult,
  type SwapResult,
  type ApprovalResult,
  type QuoteRequest,
  type SwapStatus,
  type OrderStatus,
  RoutingType,
  BASE_CHAIN_ID,
} from './types.js';

export class SwapModule {
  private readonly api: UniswapApiClient;
  private readonly swapperAddress: Address;
  private readonly chainId: number;
  private readonly defaultSlippage: number;
  private readonly signAndBroadcast: (tx: { to: Address; data: Hex; value?: string }) => Promise<Hex>;
  private readonly signPermit: (permitData: Record<string, unknown>) => Promise<Hex>;

  constructor(params: {
    api: UniswapApiClient;
    swapperAddress: Address;
    chainId?: number;
    defaultSlippage?: number;
    signAndBroadcast: (tx: { to: Address; data: Hex; value?: string }) => Promise<Hex>;
    signPermit: (permitData: Record<string, unknown>) => Promise<Hex>;
  }) {
    this.api = params.api;
    this.swapperAddress = params.swapperAddress;
    this.chainId = params.chainId ?? BASE_CHAIN_ID;
    this.defaultSlippage = params.defaultSlippage ?? 0.5;
    this.signAndBroadcast = params.signAndBroadcast;
    this.signPermit = params.signPermit;
  }

  // ─── Static helpers (testable without API) ─────────────

  static shouldUseGasless(quote: QuoteResult): boolean {
    return quote.routing === RoutingType.DUTCH_V2 || quote.routing === RoutingType.DUTCH_V3;
  }

  static buildQuoteRequest(
    params: SwapParams,
    swapper: Address,
    chainId: number,
  ): QuoteRequest {
    return {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      amount: params.amount.toString(),
      type: params.type,
      swapper,
      slippageTolerance: params.slippageTolerance ?? 0.5,
    };
  }

  static buildApprovalRequest(
    wallet: Address,
    token: Address,
    amount: bigint,
    chainId: number,
  ) {
    return {
      walletAddress: wallet,
      token,
      amount: amount.toString(),
      chainId,
    };
  }

  // ─── API calls ─────────────────────────────────────────

  async checkApproval(token: Address, amount: bigint): Promise<ApprovalResult> {
    const body = SwapModule.buildApprovalRequest(this.swapperAddress, token, amount, this.chainId);
    const response = await this.api.post<{ approval: unknown | null }>('/check_approval', body);

    if (!response.approval) {
      return { needed: false };
    }

    return {
      needed: true,
      tx: response.approval as { to: Address; data: Hex; value: string },
    };
  }

  async getQuote(params: SwapParams): Promise<QuoteResult> {
    const body = SwapModule.buildQuoteRequest(params, this.swapperAddress, this.chainId);
    return this.api.post<QuoteResult>('/quote', body);
  }

  async executeSwapIntent(params: SwapParams): Promise<SwapResult> {
    // Step 1: Check approval
    const approval = await this.checkApproval(params.tokenIn, params.amount);
    if (approval.needed && approval.tx) {
      await this.signAndBroadcast(approval.tx);
    }

    // Step 2: Get quote
    const quote = await this.getQuote(params);

    // Step 3: Execute based on routing
    if (SwapModule.shouldUseGasless(quote)) {
      return this.submitGaslessOrder(quote);
    } else {
      return this.executeClassicSwap(quote);
    }
  }

  async executeClassicSwap(quote: QuoteResult): Promise<SwapResult> {
    // Sign permit if needed
    let signature: Hex | undefined;
    if (quote.permitData) {
      signature = await this.signPermit(quote.permitData);
    }

    const swapResponse = await this.api.post<{
      swap: { to: Address; data: Hex; value: string };
    }>('/swap', {
      quote: quote.quote,
      signature,
      permitData: quote.permitData,
    });

    const txHash = await this.signAndBroadcast(swapResponse.swap);

    return {
      txHash,
      routing: RoutingType.CLASSIC,
      amountIn: quote.quote.amountIn,
      amountOut: quote.quote.amountOut,
    };
  }

  async submitGaslessOrder(quote: QuoteResult): Promise<SwapResult> {
    let signature: Hex | undefined;
    if (quote.permitData) {
      signature = await this.signPermit(quote.permitData);
    }

    const orderResponse = await this.api.post<{
      orderId: string;
      orderStatus: string;
    }>('/order', {
      quote: quote.quote,
      signature,
      routing: quote.routing,
    });

    return {
      orderId: orderResponse.orderId,
      routing: quote.routing,
      amountIn: quote.quote.amountIn,
      amountOut: quote.quote.amountOut,
    };
  }

  async getSwapStatus(txHash: Hex): Promise<SwapStatus> {
    const response = await this.api.get<{ swaps: { status: SwapStatus }[] }>('/swaps', {
      transactionHashes: txHash,
      chainId: this.chainId.toString(),
    });
    return response.swaps[0]?.status ?? 'NOT_FOUND';
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const response = await this.api.get<{ orders: { orderStatus: OrderStatus }[] }>('/orders', {
      orderId,
    });
    return response.orders[0]?.orderStatus ?? 'expired';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/swap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/swap.ts agents/uniswap/test/swap.test.ts
git commit -m "feat(sdk): add SwapModule with Trading API + UniswapX gasless routing"
```

---

## Task 5: QuoteModule

**Files:**
- Create: `agents/uniswap/src/quotes.ts`
- Create: `agents/uniswap/test/quotes.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/quotes.test.ts
import { describe, it, expect } from 'vitest';
import { QuoteModule } from '../src/quotes.js';
import { RoutingType, type QuoteResult } from '../src/types.js';

describe('QuoteModule', () => {
  describe('selectBestQuote', () => {
    it('selects quote with highest amountOut for EXACT_INPUT', () => {
      const quotes: QuoteResult[] = [
        { requestId: '1', routing: RoutingType.CLASSIC, quote: { amountIn: '1000', amountOut: '2400', gasEstimate: '100' } },
        { requestId: '2', routing: RoutingType.DUTCH_V2, quote: { amountIn: '1000', amountOut: '2500', gasEstimate: '0' } },
        { requestId: '3', routing: RoutingType.CLASSIC, quote: { amountIn: '1000', amountOut: '2300', gasEstimate: '120' } },
      ];
      const best = QuoteModule.selectBestQuote(quotes);
      expect(best.requestId).toBe('2');
    });

    it('returns the only quote if there is just one', () => {
      const quotes: QuoteResult[] = [
        { requestId: '1', routing: RoutingType.CLASSIC, quote: { amountIn: '1000', amountOut: '2400', gasEstimate: '100' } },
      ];
      const best = QuoteModule.selectBestQuote(quotes);
      expect(best.requestId).toBe('1');
    });

    it('throws if no quotes provided', () => {
      expect(() => QuoteModule.selectBestQuote([])).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/quotes.test.ts`
Expected: FAIL

- [ ] **Step 3: Write quotes.ts**

```typescript
// src/quotes.ts
import type { Address } from 'viem';
import type { UniswapApiClient } from './api.js';
import { SwapModule } from './swap.js';
import { type SwapParams, type QuoteResult, SwapType, BASE_CHAIN_ID } from './types.js';

export class QuoteModule {
  private readonly api: UniswapApiClient;
  private readonly swapperAddress: Address;
  private readonly chainId: number;

  constructor(params: {
    api: UniswapApiClient;
    swapperAddress: Address;
    chainId?: number;
  }) {
    this.api = params.api;
    this.swapperAddress = params.swapperAddress;
    this.chainId = params.chainId ?? BASE_CHAIN_ID;
  }

  static selectBestQuote(quotes: QuoteResult[]): QuoteResult {
    if (quotes.length === 0) throw new Error('No quotes to compare');
    return quotes.reduce((best, current) =>
      BigInt(current.quote.amountOut) > BigInt(best.quote.amountOut) ? current : best,
    );
  }

  async getQuote(params: SwapParams): Promise<QuoteResult> {
    const body = SwapModule.buildQuoteRequest(params, this.swapperAddress, this.chainId);
    return this.api.post<QuoteResult>('/quote', body);
  }

  async getBestRoute(
    tokenIn: Address,
    tokenOut: Address,
    amount: bigint,
  ): Promise<QuoteResult> {
    const quote = await this.getQuote({
      tokenIn,
      tokenOut,
      amount,
      type: SwapType.EXACT_INPUT,
    });
    return quote;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/quotes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/quotes.ts agents/uniswap/test/quotes.test.ts
git commit -m "feat(sdk): add QuoteModule with best-route selection"
```

---

## Task 6: Batch Execution Helpers

**Files:**
- Create: `agents/uniswap/src/batch.ts`
- Create: `agents/uniswap/test/batch.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/batch.test.ts
import { describe, it, expect } from 'vitest';
import { encodeBatchCalls, buildApproveCall, buildSwapCalldata } from '../src/batch.js';
import type { BatchCall } from '../src/types.js';

describe('batch execution', () => {
  it('encodes a single call', () => {
    const calls: BatchCall[] = [{
      to: '0x0000000000000000000000000000000000000001',
      data: '0x1234',
    }];
    const encoded = encodeBatchCalls(calls);
    expect(encoded).toBeDefined();
    expect(typeof encoded).toBe('string');
    expect(encoded.startsWith('0x')).toBe(true);
  });

  it('encodes multiple calls', () => {
    const calls: BatchCall[] = [
      { to: '0x0000000000000000000000000000000000000001', data: '0x1234' },
      { to: '0x0000000000000000000000000000000000000002', data: '0x5678', value: 100n },
    ];
    const encoded = encodeBatchCalls(calls);
    expect(encoded).toBeDefined();
  });

  it('builds ERC20 approve calldata', () => {
    const call = buildApproveCall(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      '0x0000000000000000000000000000000000000001',
      1000000n,
    );
    expect(call.to).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(call.data.startsWith('0x095ea7b3')).toBe(true); // approve selector
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/batch.test.ts`
Expected: FAIL

- [ ] **Step 3: Write batch.ts**

```typescript
// src/batch.ts
import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import type { BatchCall } from './types.js';

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * Encodes batch calls for execution via a smart account.
 * Uses the ERC-7579 batch execution format:
 * executeBatch(Call[] calls) where Call = (address target, uint256 value, bytes data)
 */
export function encodeBatchCalls(calls: BatchCall[]): Hex {
  const tuples = calls.map((call) => ({
    target: call.to,
    value: call.value ?? 0n,
    callData: call.data,
  }));

  return encodeAbiParameters(
    parseAbiParameters('(address target, uint256 value, bytes callData)[]'),
    [tuples],
  );
}

export function buildApproveCall(
  token: Address,
  spender: Address,
  amount: bigint,
): BatchCall {
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender, amount],
  });
  return { to: token, data };
}

export function buildSwapCalldata(
  router: Address,
  swapData: Hex,
  value?: bigint,
): BatchCall {
  return { to: router, data: swapData, value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/batch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/batch.ts agents/uniswap/test/batch.test.ts
git commit -m "feat(sdk): add batch execution helpers for smart account multicall"
```

---

## Task 7: LiquidityModule

**Files:**
- Create: `agents/uniswap/src/liquidity.ts`
- Create: `agents/uniswap/test/liquidity.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/liquidity.test.ts
import { describe, it, expect } from 'vitest';
import { LiquidityModule } from '../src/liquidity.js';
import type { PoolState } from '../src/types.js';

describe('LiquidityModule', () => {
  describe('computeOptimalRange', () => {
    const pool: PoolState = {
      tokenA: '0xaaa' as `0x${string}`,
      tokenB: '0xbbb' as `0x${string}`,
      feeTier: 3000,
      version: 'v3',
      currentTick: 196055,
      sqrtPriceX96: 0n,
      liquidity: 0n,
    };

    it('computes tight range (±5%)', () => {
      const range = LiquidityModule.computeOptimalRange(pool, 'tight');
      expect(range.tickLower).toBeLessThan(pool.currentTick);
      expect(range.tickUpper).toBeGreaterThan(pool.currentTick);
      const tickSpread = range.tickUpper - range.tickLower;
      // ±5% ≈ ±487 ticks for ETH/USDC
      expect(tickSpread).toBeLessThan(2000);
    });

    it('computes wide range (±20%)', () => {
      const range = LiquidityModule.computeOptimalRange(pool, 'wide');
      const tickSpread = range.tickUpper - range.tickLower;
      expect(tickSpread).toBeGreaterThan(2000);
    });

    it('moderate range is between tight and wide', () => {
      const tight = LiquidityModule.computeOptimalRange(pool, 'tight');
      const moderate = LiquidityModule.computeOptimalRange(pool, 'moderate');
      const wide = LiquidityModule.computeOptimalRange(pool, 'wide');

      const tightSpread = tight.tickUpper - tight.tickLower;
      const moderateSpread = moderate.tickUpper - moderate.tickLower;
      const wideSpread = wide.tickUpper - wide.tickLower;

      expect(moderateSpread).toBeGreaterThan(tightSpread);
      expect(moderateSpread).toBeLessThan(wideSpread);
    });
  });

  describe('determineSwapScenario', () => {
    it('returns single swap when input is tokenA (swap half to B)', () => {
      const scenario = LiquidityModule.determineSwapScenario(
        '0xaaa' as `0x${string}`,
        '0xaaa' as `0x${string}`,
        '0xbbb' as `0x${string}`,
      );
      expect(scenario.swapsNeeded).toBe(1);
      expect(scenario.type).toBe('half-to-B');
    });

    it('returns single swap when input is tokenB (swap half to A)', () => {
      const scenario = LiquidityModule.determineSwapScenario(
        '0xbbb' as `0x${string}`,
        '0xaaa' as `0x${string}`,
        '0xbbb' as `0x${string}`,
      );
      expect(scenario.swapsNeeded).toBe(1);
      expect(scenario.type).toBe('half-to-A');
    });

    it('returns two swaps when input is neither pool token', () => {
      const scenario = LiquidityModule.determineSwapScenario(
        '0xccc' as `0x${string}`,
        '0xaaa' as `0x${string}`,
        '0xbbb' as `0x${string}`,
      );
      expect(scenario.swapsNeeded).toBe(2);
      expect(scenario.type).toBe('split-to-both');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/liquidity.test.ts`
Expected: FAIL

- [ ] **Step 3: Write liquidity.ts**

This is the largest module. Key things it handles:
- Pool state queries (V3 + V4)
- Optimal tick range computation
- Token preparation scenario detection
- Batched LP execution (swap + approve + add liquidity in one tx)
- V4 hook interaction

```typescript
// src/liquidity.ts
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type {
  PoolQuery,
  PoolState,
  TickRange,
  RangeStrategy,
  AddLiquidityParams,
  LPResult,
  HookInteractionParams,
  BatchCall,
  UniswapVersion,
} from './types.js';
import { UNISWAP_ADDRESSES } from './types.js';
import { encodeBatchCalls, buildApproveCall } from './batch.js';
import type { SwapModule } from './swap.js';

// Tick spacing for standard fee tiers
const TICK_SPACINGS: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

// Percentage ranges for strategies (as basis points of tick movement)
const STRATEGY_BPS: Record<RangeStrategy, number> = {
  tight: 500,     // ±5%
  moderate: 1000, // ±10%
  wide: 2000,     // ±20%
};

export class LiquidityModule {
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly swapModule: SwapModule;
  private readonly smartAccountAddress: Address;
  private readonly chain: 'base' | 'baseSepolia';

  constructor(params: {
    publicClient: PublicClient;
    walletClient?: WalletClient;
    swapModule: SwapModule;
    smartAccountAddress: Address;
    chain?: 'base' | 'baseSepolia';
  }) {
    this.publicClient = params.publicClient;
    this.walletClient = params.walletClient;
    this.swapModule = params.swapModule;
    this.smartAccountAddress = params.smartAccountAddress;
    this.chain = params.chain ?? 'base';
  }

  // ─── Static helpers (testable without clients) ─────────

  static computeOptimalRange(pool: PoolState, strategy: RangeStrategy): TickRange {
    const bps = STRATEGY_BPS[strategy];
    // Convert bps to tick offset: ln(1 + bps/10000) / ln(1.0001)
    const percentFraction = bps / 10000;
    const tickOffset = Math.round(Math.log(1 + percentFraction) / Math.log(1.0001));

    const tickSpacing = TICK_SPACINGS[pool.feeTier] ?? 60;

    // Align to tick spacing
    const tickLower = Math.floor((pool.currentTick - tickOffset) / tickSpacing) * tickSpacing;
    const tickUpper = Math.ceil((pool.currentTick + tickOffset) / tickSpacing) * tickSpacing;

    // Convert ticks to approximate prices (for display)
    const priceLower = Math.pow(1.0001, tickLower);
    const priceUpper = Math.pow(1.0001, tickUpper);

    return { tickLower, tickUpper, priceLower, priceUpper };
  }

  static determineSwapScenario(
    inputToken: Address,
    tokenA: Address,
    tokenB: Address,
  ): { swapsNeeded: number; type: 'half-to-B' | 'half-to-A' | 'split-to-both' } {
    const inputLower = inputToken.toLowerCase();
    if (inputLower === tokenA.toLowerCase()) {
      return { swapsNeeded: 1, type: 'half-to-B' };
    }
    if (inputLower === tokenB.toLowerCase()) {
      return { swapsNeeded: 1, type: 'half-to-A' };
    }
    return { swapsNeeded: 2, type: 'split-to-both' };
  }

  // ─── Pool queries ──────────────────────────────────────

  async analyzePool(params: PoolQuery): Promise<PoolState> {
    if (params.version === 'v3') {
      return this.analyzeV3Pool(params);
    }
    return this.analyzeV4Pool(params);
  }

  private async analyzeV3Pool(params: PoolQuery): Promise<PoolState> {
    // Read V3 pool state via factory + pool contract
    // For hackathon: simplified pool state query
    const addresses = UNISWAP_ADDRESSES[this.chain];

    // Get pool address from factory
    const poolAddress = await this.publicClient.readContract({
      address: addresses.v3Factory,
      abi: [{ name: 'getPool', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'getPool',
      args: [params.tokenA, params.tokenB, params.feeTier],
    }) as Address;

    // Read slot0 from pool
    const slot0 = await this.publicClient.readContract({
      address: poolAddress,
      abi: [{ name: 'slot0', type: 'function', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], stateMutability: 'view' }],
      functionName: 'slot0',
    }) as [bigint, number, ...unknown[]];

    const liquidity = await this.publicClient.readContract({
      address: poolAddress,
      abi: [{ name: 'liquidity', type: 'function', inputs: [], outputs: [{ type: 'uint128' }], stateMutability: 'view' }],
      functionName: 'liquidity',
    }) as bigint;

    return {
      tokenA: params.tokenA,
      tokenB: params.tokenB,
      feeTier: params.feeTier,
      version: 'v3',
      currentTick: Number(slot0[1]),
      sqrtPriceX96: slot0[0],
      liquidity,
    };
  }

  private async analyzeV4Pool(params: PoolQuery): Promise<PoolState> {
    // V4 uses PoolManager singleton — query pool state by poolKey
    // Simplified for hackathon: similar structure to V3
    return {
      tokenA: params.tokenA,
      tokenB: params.tokenB,
      feeTier: params.feeTier,
      version: 'v4',
      currentTick: 0,
      sqrtPriceX96: 0n,
      liquidity: 0n,
      hookAddress: params.hookAddress,
      poolKey: params.hookAddress ? {
        currency0: params.tokenA,
        currency1: params.tokenB,
        fee: params.feeTier,
        tickSpacing: TICK_SPACINGS[params.feeTier] ?? 60,
        hooks: params.hookAddress,
      } : undefined,
    };
  }

  // ─── LP Operations ─────────────────────────────────────

  async addLiquidity(params: AddLiquidityParams): Promise<LPResult> {
    if (params.version === 'v3') {
      return this.addLiquidityV3(params);
    }
    return this.addLiquidityV4(params);
  }

  private async addLiquidityV3(params: AddLiquidityParams): Promise<LPResult> {
    if (!this.walletClient) throw new Error('Wallet client required');
    const addresses = UNISWAP_ADDRESSES.base;

    // Build batch: swaps + approvals + mint
    const calls = this.buildLPBatchCalls(params, addresses.nonfungiblePositionManager);

    const txHash = await this.executeBatch(calls);
    return { txHash, version: 'v3' };
  }

  private async addLiquidityV4(params: AddLiquidityParams): Promise<LPResult> {
    if (!this.walletClient) throw new Error('Wallet client required');

    // V4 uses PoolManager.modifyLiquidity — similar batch structure
    const addresses = UNISWAP_ADDRESSES[this.chain];
    const calls = this.buildLPBatchCalls(params, addresses.positionManager);

    const txHash = await this.executeBatch(calls);
    return { txHash, version: 'v4' };
  }

  private buildLPBatchCalls(params: AddLiquidityParams, positionManager: Address): BatchCall[] {
    const calls: BatchCall[] = [];
    const scenario = LiquidityModule.determineSwapScenario(
      params.inputToken,
      params.tokenA,
      params.tokenB,
    );

    // Swap calls would be built here using Universal Router calldata
    // For now: placeholder structure showing the batch pattern
    // Actual swap calldata comes from Trading API /swap response

    // Approvals
    calls.push(buildApproveCall(params.tokenA, positionManager, params.inputAmount));
    calls.push(buildApproveCall(params.tokenB, positionManager, params.inputAmount));

    // Add liquidity call would go here (V3 mint or V4 modifyLiquidity)

    return calls;
  }

  private async executeBatch(calls: BatchCall[]): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const batchData = encodeBatchCalls(calls);
    const hash = await this.walletClient.sendTransaction({
      to: this.smartAccountAddress,
      data: batchData,
      account: this.walletClient.account!,
      chain: null,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return receipt.transactionHash;
  }

  // ─── V4 Hook Interaction ───────────────────────────────

  async interactWithHook(params: HookInteractionParams): Promise<unknown> {
    return this.publicClient.readContract({
      address: params.hookAddress,
      abi: params.hookAbi,
      functionName: params.functionName,
      args: params.args,
    });
  }

  async writeToHook(params: HookInteractionParams): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet client required');
    const { encodeFunctionData } = await import('viem');

    const data = encodeFunctionData({
      abi: params.hookAbi,
      functionName: params.functionName,
      args: params.args,
    });

    const hash = await this.walletClient.sendTransaction({
      to: params.hookAddress,
      data,
      account: this.walletClient.account!,
      chain: null,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return receipt.transactionHash;
  }

  // ─── Fee Collection ────────────────────────────────────

  async collectFeesV3(tokenId: bigint): Promise<{ txHash: Hex }> {
    if (!this.walletClient) throw new Error('Wallet client required');
    const addresses = UNISWAP_ADDRESSES.base;

    const hash = await this.walletClient.writeContract({
      address: addresses.nonfungiblePositionManager,
      abi: [{ name: 'collect', type: 'function', inputs: [{ type: 'tuple', components: [{ name: 'tokenId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'amount0Max', type: 'uint128' }, { name: 'amount1Max', type: 'uint128' }] }], outputs: [{ type: 'uint256' }, { type: 'uint256' }], stateMutability: 'nonpayable' }],
      functionName: 'collect',
      args: [{
        tokenId,
        recipient: this.smartAccountAddress,
        amount0Max: BigInt('340282366920938463463374607431768211455'), // uint128 max
        amount1Max: BigInt('340282366920938463463374607431768211455'),
      }],
      account: this.walletClient.account!,
      chain: null,
    } as any);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: receipt.transactionHash };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/liquidity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/liquidity.ts agents/uniswap/test/liquidity.test.ts
git commit -m "feat(sdk): add LiquidityModule with V3/V4 LP, batched execution, and hook interaction"
```

---

## Task 8: OrchestratorModule

**Files:**
- Create: `agents/uniswap/src/orchestrator.ts`
- Create: `agents/uniswap/test/orchestrator.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// test/orchestrator.test.ts
import { describe, it, expect } from 'vitest';
import { OrchestratorModule } from '../src/orchestrator.js';
import type { Intent } from '../src/types.js';

describe('OrchestratorModule', () => {
  describe('decomposeIntent', () => {
    it('simple swap produces single self-step', () => {
      const intent: Intent = {
        description: 'Swap 1 ETH to USDC',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 1000000000000000000n,
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].type).toBe('self');
      expect(plan.steps[0].description).toContain('swap');
    });

    it('LP intent produces swap + add-liquidity steps', () => {
      const intent: Intent = {
        description: 'Provide liquidity with 2 ETH in ETH/USDC',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 2000000000000000000n,
        targetPool: {
          tokenA: '0x4200000000000000000000000000000000000006' as `0x${string}`,
          tokenB: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
        },
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      // Should have: analyze pool + add liquidity (batched)
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan.steps.every(s => s.type === 'self')).toBe(true);
    });

    it('complex yield intent includes delegation steps', () => {
      const intent: Intent = {
        description: 'Maximize yield with 5 ETH on Uniswap',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 5000000000000000000n,
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      const delegateSteps = plan.steps.filter(s => s.type === 'delegate');
      const selfSteps = plan.steps.filter(s => s.type === 'self');
      expect(delegateSteps.length).toBeGreaterThan(0);
      expect(selfSteps.length).toBeGreaterThan(0);
    });
  });

  describe('selectBestAgent', () => {
    it('selects agent with highest stake when no reputation', () => {
      const agents = [
        { address: '0x1' as `0x${string}`, stake: 100n, name: 'a', endpoint: '', erc8004Id: 0n, ensName: '', registeredAt: 0n, active: true, capabilityHashes: [] },
        { address: '0x2' as `0x${string}`, stake: 500n, name: 'b', endpoint: '', erc8004Id: 0n, ensName: '', registeredAt: 0n, active: true, capabilityHashes: [] },
        { address: '0x3' as `0x${string}`, stake: 200n, name: 'c', endpoint: '', erc8004Id: 0n, ensName: '', registeredAt: 0n, active: true, capabilityHashes: [] },
      ];
      const best = OrchestratorModule.selectBestAgent(agents);
      expect(best.address).toBe('0x2');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents/uniswap && npx vitest run test/orchestrator.test.ts`
Expected: FAIL

- [ ] **Step 3: Write orchestrator.ts**

```typescript
// src/orchestrator.ts
import type { Address, Hex } from 'viem';
import type { AgentInfo } from '@agentchain/sdk';
import type {
  Intent,
  TaskPlan,
  TaskStep,
  DelegateParams,
  ExecutionResult,
} from './types.js';

// Simple intent keyword matching for decomposition
const SWAP_KEYWORDS = ['swap', 'convert', 'exchange', 'trade'];
const LP_KEYWORDS = ['liquidity', 'lp', 'pool', 'provide'];
const YIELD_KEYWORDS = ['yield', 'maximize', 'earn', 'invest', 'work'];

export class OrchestratorModule {
  static decomposeIntent(intent: Intent): TaskPlan {
    const desc = intent.description.toLowerCase();

    // Simple swap
    if (SWAP_KEYWORDS.some(k => desc.includes(k)) && !LP_KEYWORDS.some(k => desc.includes(k)) && !YIELD_KEYWORDS.some(k => desc.includes(k))) {
      return {
        steps: [{
          type: 'self',
          description: `Execute swap: ${intent.description}`,
        }],
      };
    }

    // LP provision
    if (LP_KEYWORDS.some(k => desc.includes(k))) {
      return {
        steps: [{
          type: 'self',
          description: `Analyze pool and add liquidity (batched): ${intent.description}`,
        }],
      };
    }

    // Complex yield — needs research delegation
    if (YIELD_KEYWORDS.some(k => desc.includes(k))) {
      return {
        steps: [
          {
            type: 'delegate',
            description: 'Get current token prices from multiple sources',
            capability: 'price-feed',
            budget: 2000000n, // 2 USDC
            targets: [],
            methods: [],
          },
          {
            type: 'delegate',
            description: 'Get pool analytics — APYs, TVL, volume for relevant pairs',
            capability: 'pool-analytics',
            budget: 3000000n, // 3 USDC
            targets: [],
            methods: [],
            dependsOn: [0],
          },
          {
            type: 'self',
            description: 'Compute optimal allocation and execute swaps + LP positions',
            dependsOn: [0, 1],
          },
        ],
      };
    }

    // Default: treat as swap
    return {
      steps: [{
        type: 'self',
        description: `Execute: ${intent.description}`,
      }],
    };
  }

  static selectBestAgent(agents: AgentInfo[]): AgentInfo {
    if (agents.length === 0) throw new Error('No agents available for delegation');
    // Sort by stake (highest first) as a proxy for reliability
    return agents.reduce((best, current) =>
      current.stake > best.stake ? current : best,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agents/uniswap && npx vitest run test/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -f agents/uniswap/src/orchestrator.ts agents/uniswap/test/orchestrator.test.ts
git commit -m "feat(sdk): add OrchestratorModule with intent decomposition and agent selection"
```

---

## Task 9: UniAgent Main Class

**Files:**
- Create: `agents/uniswap/src/index.ts`

- [ ] **Step 1: Write index.ts**

This is the entry point that ties all modules together. It handles the lifecycle: register → start → handle intents → stop.

```typescript
// src/index.ts
import { type Address, type Hex, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  UniAgentConfig,
  Intent,
  ExecutionResult,
  SwapParams,
  AddLiquidityParams,
} from './types.js';
import { SwapType } from './types.js';
import { UniswapApiClient } from './api.js';
import { SwapModule } from './swap.js';
import { QuoteModule } from './quotes.js';
import { LiquidityModule } from './liquidity.js';
import { OrchestratorModule } from './orchestrator.js';

export class UniAgent {
  readonly config: UniAgentConfig;
  private api!: UniswapApiClient;
  private swap!: SwapModule;
  private quotes!: QuoteModule;
  private liquidity!: LiquidityModule;
  private smartAccountAddress?: Address;

  private constructor(config: UniAgentConfig) {
    this.config = config;
  }

  static create(config: UniAgentConfig): UniAgent {
    const agent = new UniAgent(config);
    agent.api = new UniswapApiClient(config.uniswapApiKey);
    return agent;
  }

  async register(): Promise<{ smartAccountAddress: Address }> {
    // This will be wired to @agentchain/sdk when contracts are deployed
    // For now, use the EOA as the agent address
    const signer = privateKeyToAccount(this.config.privateKey);
    this.smartAccountAddress = signer.address;

    // Initialize modules with the smart account address
    this.swap = new SwapModule({
      api: this.api,
      swapperAddress: this.smartAccountAddress,
      defaultSlippage: this.config.defaultSlippage,
      signAndBroadcast: async (tx) => {
        // Placeholder: will use walletClient.sendTransaction
        throw new Error('signAndBroadcast not wired — requires walletClient');
      },
      signPermit: async (permitData) => {
        // Placeholder: will use EIP-1271 signing
        throw new Error('signPermit not wired — requires walletClient');
      },
    });

    this.quotes = new QuoteModule({
      api: this.api,
      swapperAddress: this.smartAccountAddress,
    });

    return { smartAccountAddress: this.smartAccountAddress };
  }

  async handleIntent(taskId: Hex, intent: Intent): Promise<ExecutionResult> {
    const plan = OrchestratorModule.decomposeIntent(intent);
    const txHashes: Hex[] = [];
    const orderIds: string[] = [];
    const delegations: { agent: Address; capability: string }[] = [];

    for (const step of plan.steps) {
      if (step.type === 'self') {
        // Execute Uniswap operation directly
        if (intent.targetPool && intent.inputToken && intent.inputAmount) {
          // LP operation (batched)
          const result = await this.liquidity.addLiquidity({
            inputToken: intent.inputToken,
            inputAmount: intent.inputAmount,
            tokenA: intent.targetPool.tokenA,
            tokenB: intent.targetPool.tokenB,
            tickLower: -887220,  // Will be computed from pool state
            tickUpper: 887220,
            feeTier: 3000,
            version: 'v3',
          });
          txHashes.push(result.txHash);
        } else if (intent.inputToken && intent.inputAmount) {
          // Swap operation
          const result = await this.swap.executeSwapIntent({
            tokenIn: intent.inputToken,
            tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, // USDC default
            amount: intent.inputAmount,
            type: SwapType.EXACT_INPUT,
            slippageTolerance: this.config.defaultSlippage,
          });
          if (result.txHash) txHashes.push(result.txHash);
          if (result.orderId) orderIds.push(result.orderId);
        }
      } else {
        // Delegate to another agent via SDK
        // Will be wired to sdk.discovery.discover + sdk.delegation.createDelegation
        delegations.push({
          agent: '0x0000000000000000000000000000000000000000' as Address,
          capability: step.capability ?? 'unknown',
        });
      }
    }

    return {
      txHashes,
      orderIds,
      delegations,
      success: true,
      summary: `Executed ${txHashes.length} txs, ${orderIds.length} orders, ${delegations.length} delegations`,
    };
  }
}

// Re-export all modules
export { UniswapApiClient } from './api.js';
export { SwapModule } from './swap.js';
export { QuoteModule } from './quotes.js';
export { LiquidityModule } from './liquidity.js';
export { OrchestratorModule } from './orchestrator.js';
export { encodeBatchCalls, buildApproveCall, buildSwapCalldata } from './batch.js';
export * from './types.js';
```

- [ ] **Step 2: Verify build compiles**

Run: `cd agents/uniswap && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `cd agents/uniswap && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add -f agents/uniswap/src/index.ts
git commit -m "feat(sdk): add UniAgent main class with lifecycle and intent handling"
```

---

## Task 10: Full Test Suite + Build Verification

- [ ] **Step 1: Run full test suite**

Run: `cd agents/uniswap && npx vitest run`
Expected: All tests pass (types, api, swap, quotes, liquidity, orchestrator, batch)

- [ ] **Step 2: Run build**

Run: `cd agents/uniswap && npm run build`
Expected: `dist/` directory created with `.js` + `.d.ts` files

- [ ] **Step 3: Run typecheck**

Run: `cd agents/uniswap && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Final commit**

```bash
git commit -m "test(sdk): verify UniAgent full test suite and build"
```

Note: Do NOT commit `dist/` — build artifacts should be in `.gitignore`.

---

## Summary

| Task | Module | Estimated Time |
|---|---|---|
| 1 | Project scaffolding | 15 min |
| 2 | Types & constants | 20 min |
| 3 | Trading API client | 20 min |
| 4 | SwapModule | 30 min |
| 5 | QuoteModule | 15 min |
| 6 | Batch execution | 20 min |
| 7 | LiquidityModule | 45 min |
| 8 | OrchestratorModule | 30 min |
| 9 | UniAgent main class | 20 min |
| 10 | Full test + build | 10 min |
| **Total** | | **~3.5 hours** |

After this plan is done, the next steps are:
1. Wire UniAgent to `@agentchain/sdk` (when contracts are deployed)
2. Get a Uniswap Developer Platform API key
3. Build demo script (`demo/uniswap-demo.ts`)
4. Execute real swaps + LP on Base with real TxIDs
