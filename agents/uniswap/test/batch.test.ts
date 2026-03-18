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
    expect(encoded.length).toBeGreaterThan(10);
  });

  it('builds ERC20 approve calldata', () => {
    const call = buildApproveCall(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      '0x0000000000000000000000000000000000000001',
      1000000n,
    );
    expect(call.to).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(call.data.startsWith('0x095ea7b3')).toBe(true); // approve(address,uint256) selector
  });

  it('builds swap calldata wrapper', () => {
    const call = buildSwapCalldata(
      '0x2626664c2603336E57B271c5C0b26F421741e481',
      '0xabcdef',
      100n,
    );
    expect(call.to).toBe('0x2626664c2603336E57B271c5C0b26F421741e481');
    expect(call.data).toBe('0xabcdef');
    expect(call.value).toBe(100n);
  });
});
