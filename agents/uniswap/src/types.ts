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
  tokenId?: bigint;
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
  capability?: string;
  budget?: bigint;
  targets?: Address[];
  methods?: string[];
  dependsOn?: number[];
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

// ─── Agent Info (compatible with @agentchain/sdk) ────────

export interface AgentInfo {
  address: Address;
  name: string;
  endpoint: string;
  erc8004Id: bigint;
  ensName: string;
  registeredAt: bigint;
  active: boolean;
  stake: bigint;
  capabilityHashes: Hex[];
}

// ─── Contract Addresses ──────────────────────────────────

export const UNISWAP_ADDRESSES = {
  base: {
    // V3
    nonfungiblePositionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1' as Address,
    swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
    v3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as Address,
    // V4
    poolManager: '0x7Da1D65F8B249183667cdE74C5CBD46dE950972a' as Address,
    positionManager: '0xbD216513d74C8cf14cf4747A28b43bEb3Ce875b' as Address,
    // Shared
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  },
  baseSepolia: {
    nonfungiblePositionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1' as Address,
    swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
    v3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as Address,
    poolManager: '0x0000000000000000000000000000000000000000' as Address,
    positionManager: '0x0000000000000000000000000000000000000000' as Address,
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
    weth: '0x4200000000000000000000000000000000000006' as Address,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  },
} as const;

export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
