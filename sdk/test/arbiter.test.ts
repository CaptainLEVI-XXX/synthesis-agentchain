import { describe, it, expect } from 'vitest';
import { encodeDemand } from '../src/core/arbiter.js';
import { keccak256, encodePacked, decodeAbiParameters } from 'viem';

describe('encodeDemand', () => {
  it('encodes DemandData to match Solidity abi.decode', () => {
    const demand = {
      taskId: keccak256(encodePacked(['string'], ['test-task'])),
      orchestrator: '0x1111111111111111111111111111111111111111' as const,
      stakeThresholdBps: 7500n,
      minReputation: 30n,
      reputationRequired: true,
    };

    const encoded = encodeDemand(demand);
    expect(encoded.startsWith('0x')).toBe(true);

    // Decode round-trip
    const decoded = decodeAbiParameters(
      [
        { name: 'taskId', type: 'bytes32' },
        { name: 'orchestrator', type: 'address' },
        { name: 'stakeThresholdBps', type: 'uint256' },
        { name: 'minReputation', type: 'int128' },
        { name: 'reputationRequired', type: 'bool' },
      ],
      encoded,
    );
    expect(decoded[0]).toBe(demand.taskId);
    expect(decoded[1]).toBe(demand.orchestrator);
    expect(decoded[2]).toBe(7500n);
    expect(decoded[3]).toBe(30n);
    expect(decoded[4]).toBe(true);
  });
});
