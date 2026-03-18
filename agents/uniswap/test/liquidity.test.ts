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

    it('aligns ticks to tick spacing', () => {
      const range = LiquidityModule.computeOptimalRange(pool, 'moderate');
      // Fee tier 3000 has tick spacing 60
      expect(range.tickLower % 60).toBe(0);
      expect(range.tickUpper % 60).toBe(0);
    });

    it('computes price boundaries', () => {
      const range = LiquidityModule.computeOptimalRange(pool, 'moderate');
      expect(range.priceLower).toBeGreaterThan(0);
      expect(range.priceUpper).toBeGreaterThan(range.priceLower);
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

    it('is case-insensitive for address comparison', () => {
      const scenario = LiquidityModule.determineSwapScenario(
        '0xAAA' as `0x${string}`,
        '0xaaa' as `0x${string}`,
        '0xbbb' as `0x${string}`,
      );
      expect(scenario.swapsNeeded).toBe(1);
      expect(scenario.type).toBe('half-to-B');
    });
  });
});
