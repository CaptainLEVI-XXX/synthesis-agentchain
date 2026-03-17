import {
  type Hex,
  type Address,
  type TransactionReceipt,
  encodeAbiParameters,
  zeroAddress,
  zeroHash,
} from 'viem';
import { AgentChainArbiterAbi } from '../abis/AgentChainArbiter.js';
import type { DemandData } from '../types/index.js';
import type { AgentChainClient } from '../client.js';

export function encodeDemand(demand: DemandData): Hex {
  return encodeAbiParameters(
    [
      { name: 'taskId', type: 'bytes32' },
      { name: 'orchestrator', type: 'address' },
      { name: 'stakeThresholdBps', type: 'uint256' },
      { name: 'minReputation', type: 'int128' },
      { name: 'reputationRequired', type: 'bool' },
    ],
    [
      demand.taskId,
      demand.orchestrator,
      demand.stakeThresholdBps,
      demand.minReputation,
      demand.reputationRequired,
    ],
  );
}

export class ArbiterModule {
  constructor(private readonly client: AgentChainClient) {}

  private get addr() {
    return this.client.addresses.agentChainArbiter;
  }

  private async write(fn: string, args: any[]): Promise<TransactionReceipt> {
    if (!this.client.walletClient) throw new Error('Wallet client required for write operations');
    const hash = await this.client.walletClient.writeContract({
      address: this.addr,
      abi: AgentChainArbiterAbi,
      functionName: fn,
      args,
    } as any);
    return this.client.publicClient.waitForTransactionReceipt({ hash });
  }

  async settleAndRate(taskId: Hex, rating: bigint) {
    return this.write('settleAndRate', [taskId, rating]);
  }

  async disputeAgent(params: {
    taskId: Hex;
    agentAddress: Address;
    feedbackURI: string;
    feedbackHash: Hex;
  }) {
    return this.write('disputeAgent', [
      params.taskId, params.agentAddress, params.feedbackURI, params.feedbackHash,
    ]);
  }

  async checkStatement(demand: DemandData): Promise<boolean> {
    const emptyAttestation = {
      uid: zeroHash,
      schema: zeroHash,
      time: 0n,
      expirationTime: 0n,
      revocationTime: 0n,
      refUID: zeroHash,
      attester: zeroAddress,
      recipient: zeroAddress,
      revocable: false,
      data: '0x' as Hex,
    };

    return this.client.publicClient.readContract({
      address: this.addr,
      abi: AgentChainArbiterAbi,
      functionName: 'checkStatement',
      args: [emptyAttestation, encodeDemand(demand), zeroHash],
    } as any) as Promise<boolean>;
  }

  encodeDemand(demand: DemandData): Hex {
    return encodeDemand(demand);
  }
}
