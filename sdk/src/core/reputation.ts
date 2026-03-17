import {
  type Address,
  getContract,
} from 'viem';
import { ReputationRegistryAbi } from '../abis/external/ReputationRegistry.js';
import type { AgentChainClient } from '../client.js';

export class ReputationModule {
  constructor(private readonly client: AgentChainClient) {}

  private get contract() {
    return getContract({
      address: this.client.addresses.reputationRegistry,
      abi: ReputationRegistryAbi,
      client: this.client.publicClient,
    });
  }

  /**
   * Returns the list of client addresses that have given feedback for an agent.
   */
  async getClients(erc8004Id: bigint): Promise<Address[]> {
    return this.contract.read.getClients([erc8004Id]) as Promise<Address[]>;
  }

  /**
   * Returns an aggregated reputation summary for an agent.
   */
  async getSummary(
    erc8004Id: bigint,
    tag?: string,
  ): Promise<{ count: bigint; avgRating: bigint; decimals: number }> {
    const clients = await this.getClients(erc8004Id);

    if (clients.length === 0) {
      return { count: 0n, avgRating: 0n, decimals: 1 };
    }

    const [count, summaryValue, summaryValueDecimals] =
      await this.contract.read.getSummary([
        erc8004Id,
        clients,
        tag ?? 'agentchain',
        '',
      ]);

    return {
      count: BigInt(count),
      avgRating: BigInt(summaryValue),
      decimals: Number(summaryValueDecimals),
    };
  }
}
