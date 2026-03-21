import { describe, it, expect } from 'vitest';
import { encodeDemand } from '../src/core/arbiter.js';
import { decodeAbiParameters } from 'viem';

describe('encodeDemand', () => {
  it('encodes simplified DemandData (no taskId/orchestrator)', () => {
    const demand = {
      stakeThresholdBps: 7500n,
      minReputation: 30n,
      reputationRequired: true,
    };

    const encoded = encodeDemand(demand);
    expect(encoded.startsWith('0x')).toBe(true);

    // Decode round-trip
    const decoded = decodeAbiParameters(
      [
        { name: 'stakeThresholdBps', type: 'uint256' },
        { name: 'minReputation', type: 'int128' },
        { name: 'reputationRequired', type: 'bool' },
      ],
      encoded,
    );
    expect(decoded[0]).toBe(7500n);
    expect(decoded[1]).toBe(30n);
    expect(decoded[2]).toBe(true);
  });
});
