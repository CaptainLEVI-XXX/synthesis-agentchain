import {
  type Hex,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { ERC20Abi } from '../abis/external/ERC20.js';
import type { AgentChainClient } from '../client.js';
import type { DemandData } from '../types/index.js';

// Re-export to indicate the module is aware of ERC20Abi for future escrow usage
export { ERC20Abi };

export class EscrowModule {
  constructor(private readonly client: AgentChainClient) {}

  /**
   * Encodes DemandData into ABI-packed bytes for Alkahest escrow demands.
   */
  encodeDemand(demand: DemandData): Hex {
    return encodeAbiParameters(
      parseAbiParameters(
        'bytes32 taskId, address orchestrator, uint256 stakeThresholdBps, int128 minReputation, bool reputationRequired',
      ),
      [
        demand.taskId,
        demand.orchestrator,
        demand.stakeThresholdBps,
        demand.minReputation,
        demand.reputationRequired,
      ],
    );
  }

  /**
   * Creates an Alkahest escrow for a task.
   * @throws Not yet available — Alkahest escrow is not deployed.
   */
  async createEscrow(_params: {
    taskId: Hex;
    amount: bigint;
    token?: `0x${string}`;
  }): Promise<never> {
    throw new Error(
      'Alkahest escrow not yet deployed. Use tracker.registerTask() directly for testing.',
    );
  }

  /**
   * Collects payment from an Alkahest escrow after task completion.
   * @throws Not yet available — Alkahest escrow is not deployed.
   */
  async collectPayment(_taskId: Hex): Promise<never> {
    throw new Error(
      'Alkahest escrow not yet deployed. Use tracker.registerTask() directly for testing.',
    );
  }
}
