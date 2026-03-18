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

    it('chooses gasless for DUTCH_V3 routing', () => {
      const result = SwapModule.shouldUseGasless({
        routing: RoutingType.DUTCH_V3,
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

    it('chooses classic for BRIDGE routing', () => {
      const result = SwapModule.shouldUseGasless({
        routing: RoutingType.BRIDGE,
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

    it('uses default slippage when not provided', () => {
      const body = SwapModule.buildQuoteRequest({
        tokenIn: '0xaaa' as `0x${string}`,
        tokenOut: '0xbbb' as `0x${string}`,
        amount: 1000000n,
        type: SwapType.EXACT_OUTPUT,
      }, '0xswapper' as `0x${string}`, 8453);

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
