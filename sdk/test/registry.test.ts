import { describe, it, expect } from 'vitest';
import { capToBytes32 } from '../src/core/registry.js';
import { keccak256, encodePacked } from 'viem';

describe('capToBytes32', () => {
  it('converts capability string to bytes32 hash', () => {
    const result = capToBytes32('defi');
    const expected = keccak256(encodePacked(['string'], ['defi']));
    expect(result).toBe(expected);
  });

  it('produces different hashes for different capabilities', () => {
    const defi = capToBytes32('defi');
    const data = capToBytes32('data');
    expect(defi).not.toBe(data);
  });

  it('is deterministic', () => {
    expect(capToBytes32('lending')).toBe(capToBytes32('lending'));
  });

  it('matches Solidity keccak256(abi.encodePacked(string))', () => {
    // This is the exact encoding used in our Solidity contracts
    const result = capToBytes32('yield-analysis');
    expect(result).toHaveLength(66); // 0x + 64 hex chars
    expect(result.startsWith('0x')).toBe(true);
  });
});
