import type { Address } from 'viem';
import type {
  Intent,
  TaskPlan,
  AgentInfo,
} from './types.js';

const SWAP_KEYWORDS = ['swap', 'convert', 'exchange', 'trade'];
const LP_KEYWORDS = ['liquidity', 'lp', 'pool', 'provide'];
const YIELD_KEYWORDS = ['yield', 'maximize', 'earn', 'invest', 'work'];

export class OrchestratorModule {
  static decomposeIntent(intent: Intent): TaskPlan {
    const desc = intent.description.toLowerCase();

    // Simple swap
    if (SWAP_KEYWORDS.some(k => desc.includes(k)) && !LP_KEYWORDS.some(k => desc.includes(k)) && !YIELD_KEYWORDS.some(k => desc.includes(k))) {
      return {
        steps: [{
          type: 'self',
          description: `Execute swap: ${intent.description}`,
        }],
      };
    }

    // LP provision
    if (LP_KEYWORDS.some(k => desc.includes(k))) {
      return {
        steps: [{
          type: 'self',
          description: `Analyze pool and add liquidity (batched): ${intent.description}`,
        }],
      };
    }

    // Complex yield — needs research delegation
    if (YIELD_KEYWORDS.some(k => desc.includes(k))) {
      return {
        steps: [
          {
            type: 'delegate',
            description: 'Get current token prices from multiple sources',
            capability: 'price-feed',
            budget: 2000000n,
            targets: [],
            methods: [],
          },
          {
            type: 'delegate',
            description: 'Get pool analytics — APYs, TVL, volume for relevant pairs',
            capability: 'pool-analytics',
            budget: 3000000n,
            targets: [],
            methods: [],
            dependsOn: [0],
          },
          {
            type: 'self',
            description: 'Compute optimal allocation and execute swaps + LP positions',
            dependsOn: [0, 1],
          },
        ],
      };
    }

    // Default: treat as swap
    return {
      steps: [{
        type: 'self',
        description: `Execute: ${intent.description}`,
      }],
    };
  }

  static selectBestAgent(agents: AgentInfo[]): AgentInfo {
    if (agents.length === 0) throw new Error('No agents available for delegation');
    return agents.reduce((best, current) =>
      current.stake > best.stake ? current : best,
    );
  }
}
