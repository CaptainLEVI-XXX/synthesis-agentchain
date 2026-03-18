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
    return this.getQuote({
      tokenIn,
      tokenOut,
      amount,
      type: SwapType.EXACT_INPUT,
    });
  }
}
