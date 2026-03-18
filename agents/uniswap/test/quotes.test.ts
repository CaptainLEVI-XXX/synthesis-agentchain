import { describe, it, expect } from 'vitest';
import { QuoteModule } from '../src/quotes.js';
import { RoutingType, type QuoteResult } from '../src/types.js';

describe('QuoteModule', () => {
  describe('selectBestQuote', () => {
    it('selects quote with highest amountOut', () => {
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
      expect(() => QuoteModule.selectBestQuote([])).toThrow('No quotes to compare');
    });

    it('handles equal amountOut by returning first', () => {
      const quotes: QuoteResult[] = [
        { requestId: '1', routing: RoutingType.CLASSIC, quote: { amountIn: '1000', amountOut: '2500', gasEstimate: '100' } },
        { requestId: '2', routing: RoutingType.DUTCH_V2, quote: { amountIn: '1000', amountOut: '2500', gasEstimate: '0' } },
      ];
      const best = QuoteModule.selectBestQuote(quotes);
      expect(best.requestId).toBe('1');
    });
  });
});
