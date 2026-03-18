import { describe, it, expect } from 'vitest';
import { OrchestratorModule } from '../src/orchestrator.js';
import type { Intent, AgentInfo } from '../src/types.js';

describe('OrchestratorModule', () => {
  describe('decomposeIntent', () => {
    it('simple swap produces single self-step', () => {
      const intent: Intent = {
        description: 'Swap 1 ETH to USDC',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 1000000000000000000n,
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].type).toBe('self');
      expect(plan.steps[0].description.toLowerCase()).toContain('swap');
    });

    it('LP intent produces self-step for batched execution', () => {
      const intent: Intent = {
        description: 'Provide liquidity with 2 ETH in ETH/USDC pool',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 2000000000000000000n,
        targetPool: {
          tokenA: '0x4200000000000000000000000000000000000006' as `0x${string}`,
          tokenB: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
        },
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan.steps.every(s => s.type === 'self')).toBe(true);
    });

    it('complex yield intent includes delegation steps', () => {
      const intent: Intent = {
        description: 'Maximize yield with 5 ETH on Uniswap',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 5000000000000000000n,
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      const delegateSteps = plan.steps.filter(s => s.type === 'delegate');
      const selfSteps = plan.steps.filter(s => s.type === 'self');
      expect(delegateSteps.length).toBeGreaterThan(0);
      expect(selfSteps.length).toBeGreaterThan(0);
    });

    it('delegation steps have required capability field', () => {
      const intent: Intent = {
        description: 'Invest 3 ETH for best yield',
        inputToken: '0x4200000000000000000000000000000000000006' as `0x${string}`,
        inputAmount: 3000000000000000000n,
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      const delegateSteps = plan.steps.filter(s => s.type === 'delegate');
      for (const step of delegateSteps) {
        expect(step.capability).toBeDefined();
        expect(step.budget).toBeDefined();
      }
    });

    it('unknown intent defaults to swap', () => {
      const intent: Intent = {
        description: 'Do something with tokens',
      };
      const plan = OrchestratorModule.decomposeIntent(intent);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].type).toBe('self');
    });
  });

  describe('selectBestAgent', () => {
    it('selects agent with highest stake', () => {
      const agents: AgentInfo[] = [
        { address: '0x1' as `0x${string}`, stake: 100n, name: 'a', endpoint: '', erc8004Id: 0n, ensName: '', registeredAt: 0n, active: true, capabilityHashes: [] },
        { address: '0x2' as `0x${string}`, stake: 500n, name: 'b', endpoint: '', erc8004Id: 0n, ensName: '', registeredAt: 0n, active: true, capabilityHashes: [] },
        { address: '0x3' as `0x${string}`, stake: 200n, name: 'c', endpoint: '', erc8004Id: 0n, ensName: '', registeredAt: 0n, active: true, capabilityHashes: [] },
      ];
      const best = OrchestratorModule.selectBestAgent(agents);
      expect(best.address).toBe('0x2');
    });

    it('throws if no agents available', () => {
      expect(() => OrchestratorModule.selectBestAgent([])).toThrow('No agents available');
    });
  });
});
