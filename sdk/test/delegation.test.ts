import { describe, it, expect } from 'vitest';
import { composeAgentTerms } from '../src/core/delegation.js';
import { capToBytes32 } from '../src/core/registry.js';
import { decodeAbiParameters, keccak256, encodePacked } from 'viem';

describe('composeAgentTerms', () => {
  it('encodes AgentTerms to match Solidity abi.decode', () => {
    const taskId = keccak256(encodePacked(['string'], ['test-task']));
    const terms = {
      taskId,
      maxDepth: 3,
      currentDepth: 1,
      minStake: 1000n * 10n ** 6n,
      fee: 50n * 10n ** 6n,
      requiredCaps: [capToBytes32('defi'), capToBytes32('lending')],
    };

    const encoded = composeAgentTerms(terms);
    expect(encoded).toBeDefined();
    expect(encoded.startsWith('0x')).toBe(true);

    // Decode and verify round-trip
    const decoded = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'taskId', type: 'bytes32' },
            { name: 'maxDepth', type: 'uint8' },
            { name: 'currentDepth', type: 'uint8' },
            { name: 'minStake', type: 'uint256' },
            { name: 'fee', type: 'uint256' },
            { name: 'requiredCaps', type: 'bytes32[]' },
          ],
        },
      ],
      encoded,
    );
    expect(decoded[0].taskId).toBe(taskId);
    expect(decoded[0].maxDepth).toBe(3);
    expect(decoded[0].currentDepth).toBe(1);
    expect(decoded[0].minStake).toBe(1000n * 10n ** 6n);
    expect(decoded[0].fee).toBe(50n * 10n ** 6n);
    expect(decoded[0].requiredCaps.length).toBe(2);
  });

  it('handles empty requiredCaps', () => {
    const taskId = keccak256(encodePacked(['string'], ['test']));
    const encoded = composeAgentTerms({
      taskId,
      maxDepth: 1,
      currentDepth: 0,
      minStake: 0n,
      fee: 0n,
      requiredCaps: [],
    });
    expect(encoded).toBeDefined();
  });

  it('rejects depth > 255', () => {
    const taskId = keccak256(encodePacked(['string'], ['test']));
    expect(() =>
      composeAgentTerms({
        taskId,
        maxDepth: 256,
        currentDepth: 0,
        minStake: 0n,
        fee: 0n,
        requiredCaps: [],
      }),
    ).toThrow();
  });
});
