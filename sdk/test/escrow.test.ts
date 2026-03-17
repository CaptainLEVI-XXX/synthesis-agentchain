import { describe, it, expect } from 'vitest';
import { EscrowModule } from '../src/core/escrow.js';
import { keccak256, encodePacked } from 'viem';

describe('EscrowModule', () => {
  it('encodeDemand produces valid ABI encoding', () => {
    const module = new EscrowModule(null as any);
    const demand = {
      taskId: keccak256(encodePacked(['string'], ['test'])),
      orchestrator: '0x1111111111111111111111111111111111111111' as const,
      stakeThresholdBps: 7500n,
      minReputation: 30n,
      reputationRequired: true,
    };
    const encoded = module.encodeDemand(demand);
    expect(encoded).toBeDefined();
    expect(encoded.startsWith('0x')).toBe(true);
  });

  it('createEscrow throws with placeholder message', async () => {
    const module = new EscrowModule(null as any);
    await expect(
      module.createEscrow({ taskId: '0x00' as any, amount: 0n }),
    ).rejects.toThrow('Alkahest escrow not yet deployed');
  });
});
