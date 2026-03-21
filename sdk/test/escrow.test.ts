import { describe, it, expect } from 'vitest';
import { EscrowModule } from '../src/core/escrow.js';

describe('EscrowModule', () => {
  it('encodeDemand produces valid ABI encoding', () => {
    const module = new EscrowModule(null as any);
    const demand = {
      stakeThresholdBps: 7500n,
      minReputation: 30n,
      reputationRequired: true,
    };
    const encoded = module.encodeDemand(demand);
    expect(encoded).toBeDefined();
    expect(encoded.startsWith('0x')).toBe(true);
  });

  it('createEscrow requires wallet client', async () => {
    const module = new EscrowModule(null as any);
    await expect(
      module.createEscrow({ amount: 1000n, demand: { stakeThresholdBps: 7500n, minReputation: 0n, reputationRequired: false }, deadline: 9999999999n }),
    ).rejects.toThrow();
  });
});
