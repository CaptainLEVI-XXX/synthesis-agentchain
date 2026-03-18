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
    const body = SwapModule.buildQuoteRequest(
      { ...params, slippageTolerance: params.slippageTolerance ?? this.defaultSlippage },
      this.swapperAddress,
      this.chainId,
    );
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
