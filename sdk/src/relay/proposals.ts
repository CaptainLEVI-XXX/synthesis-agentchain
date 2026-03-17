import type { Address, Hex } from 'viem';
import type { AgentChainClient } from '../client.js';
import type { Proposal } from '../types/index.js';

export class RelayModule {
  private client: AgentChainClient;
  private relayUrl: string;

  constructor(client: AgentChainClient, relayUrl: string) {
    this.client = client;
    this.relayUrl = relayUrl;
  }

  async submitProposal(params: {
    taskId: Hex;
    strategy: string;
    fee: bigint;
  }): Promise<void> {
    const response = await fetch(`${this.relayUrl}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: params.taskId,
        strategy: params.strategy,
        fee: params.fee.toString(),
        agent: this.client.account?.address,
        timestamp: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Relay error: ${response.status} ${response.statusText}`);
    }
  }

  async getProposals(taskId: Hex): Promise<Proposal[]> {
    const response = await fetch(`${this.relayUrl}/proposals/${taskId}`);

    if (!response.ok) {
      throw new Error(`Relay error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return (data as any[]).map((p) => ({
      taskId: p.taskId as Hex,
      agent: p.agent as Address,
      strategy: p.strategy,
      fee: BigInt(p.fee),
      signature: p.signature as Hex,
      timestamp: p.timestamp,
    }));
  }
}
