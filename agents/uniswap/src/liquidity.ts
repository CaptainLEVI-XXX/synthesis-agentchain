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

// Percentage ranges for strategies (as basis points)
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
    const percentFraction = bps / 10000;
    const tickOffset = Math.round(Math.log(1 + percentFraction) / Math.log(1.0001));

    const tickSpacing = TICK_SPACINGS[pool.feeTier] ?? 60;

    const tickLower = Math.floor((pool.currentTick - tickOffset) / tickSpacing) * tickSpacing;
    const tickUpper = Math.ceil((pool.currentTick + tickOffset) / tickSpacing) * tickSpacing;

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
    const addresses = UNISWAP_ADDRESSES[this.chain];

    const poolAddress = await this.publicClient.readContract({
      address: addresses.v3Factory,
      abi: [{ name: 'getPool', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }], stateMutability: 'view' }] as const,
      functionName: 'getPool',
      args: [params.tokenA, params.tokenB, params.feeTier],
    }) as Address;

    const slot0 = await this.publicClient.readContract({
      address: poolAddress,
      abi: [{ name: 'slot0', type: 'function', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], stateMutability: 'view' }] as const,
      functionName: 'slot0',
    }) as unknown as [bigint, number, ...unknown[]];

    const liquidity = await this.publicClient.readContract({
      address: poolAddress,
      abi: [{ name: 'liquidity', type: 'function', inputs: [], outputs: [{ type: 'uint128' }], stateMutability: 'view' }] as const,
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
    const addresses = UNISWAP_ADDRESSES[this.chain];
    const calls = this.buildLPBatchCalls(params, addresses.nonfungiblePositionManager);
    const txHash = await this.executeBatch(calls);
    return { txHash, version: 'v3' };
  }

  private async addLiquidityV4(params: AddLiquidityParams): Promise<LPResult> {
    if (!this.walletClient) throw new Error('Wallet client required');
    const addresses = UNISWAP_ADDRESSES[this.chain];
    const calls = this.buildLPBatchCalls(params, addresses.positionManager);
    const txHash = await this.executeBatch(calls);
    return { txHash, version: 'v4' };
  }

  private buildLPBatchCalls(params: AddLiquidityParams, positionManager: Address): BatchCall[] {
    const calls: BatchCall[] = [];

    // Approvals — use max uint256 for simplicity
    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    calls.push(buildApproveCall(params.tokenA, positionManager, maxApproval));
    calls.push(buildApproveCall(params.tokenB, positionManager, maxApproval));

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
    } as any);
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
    const addresses = UNISWAP_ADDRESSES[this.chain];

    const hash = await this.walletClient.writeContract({
      address: addresses.nonfungiblePositionManager,
      abi: [{ name: 'collect', type: 'function', inputs: [{ type: 'tuple', components: [{ name: 'tokenId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'amount0Max', type: 'uint128' }, { name: 'amount1Max', type: 'uint128' }] }], outputs: [{ type: 'uint256' }, { type: 'uint256' }], stateMutability: 'nonpayable' }] as const,
      functionName: 'collect',
      args: [{
        tokenId,
        recipient: this.smartAccountAddress,
        amount0Max: BigInt('340282366920938463463374607431768211455'),
        amount1Max: BigInt('340282366920938463463374607431768211455'),
      }],
      account: this.walletClient.account!,
      chain: null,
    } as any);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: receipt.transactionHash };
  }
}
