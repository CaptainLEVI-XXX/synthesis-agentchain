import { describe, it, expect } from 'vitest';
import {
  UNISWAP_ADDRESSES,
  TRADING_API_BASE_URL,
  RoutingType,
  BASE_CHAIN_ID,
} from '../src/types.js';

describe('types and constants', () => {
  it('has correct Base chain addresses', () => {
    expect(UNISWAP_ADDRESSES.base.permit2).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3');
    expect(UNISWAP_ADDRESSES.base.weth).toBe('0x4200000000000000000000000000000000000006');
    expect(UNISWAP_ADDRESSES.base.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('has V3 contract addresses', () => {
    expect(UNISWAP_ADDRESSES.base.nonfungiblePositionManager).toBeDefined();
    expect(UNISWAP_ADDRESSES.base.swapRouter02).toBeDefined();
    expect(UNISWAP_ADDRESSES.base.v3Factory).toBeDefined();
  });

  it('has V4 contract addresses', () => {
    expect(UNISWAP_ADDRESSES.base.poolManager).toBeDefined();
    expect(UNISWAP_ADDRESSES.base.positionManager).toBeDefined();
  });

  it('has baseSepolia addresses', () => {
    expect(UNISWAP_ADDRESSES.baseSepolia.usdc).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('has correct Trading API base URL', () => {
    expect(TRADING_API_BASE_URL).toBe('https://trade-api.gateway.uniswap.org/v1');
  });

  it('has correct chain ID', () => {
    expect(BASE_CHAIN_ID).toBe(8453);
  });

  it('RoutingType enum has expected values', () => {
    expect(RoutingType.CLASSIC).toBe('CLASSIC');
    expect(RoutingType.DUTCH_V2).toBe('DUTCH_V2');
    expect(RoutingType.DUTCH_V3).toBe('DUTCH_V3');
    expect(RoutingType.WRAP).toBe('WRAP');
  });
});
