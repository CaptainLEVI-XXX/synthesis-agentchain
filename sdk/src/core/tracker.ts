import { type Address, type Hex, type TransactionReceipt } from 'viem';
import { DelegationTrackerAbi } from '../abis/DelegationTracker.js';
import { TaskStatus, type Task, type DelegationHop, type WorkRecord } from '../types/index.js';
import type { AgentChainClient } from '../client.js';

export class TrackerModule {
  constructor(private readonly client: AgentChainClient) {}

  private get addr() {
    return this.client.addresses.delegationTracker;
  }

  private async write(fn: string, args: any[]): Promise<TransactionReceipt> {
    if (!this.client.walletClient) throw new Error('Wallet client required for write operations');
    const hash = await this.client.walletClient.writeContract({
      address: this.addr,
      abi: DelegationTrackerAbi,
      functionName: fn,
      args,
    } as any);
    return this.client.publicClient.waitForTransactionReceipt({ hash });
  }

  private async read(fn: string, args?: any[]): Promise<any> {
    return this.client.publicClient.readContract({
      address: this.addr,
      abi: DelegationTrackerAbi,
      functionName: fn,
      args,
    } as any);
  }

  async registerTask(taskId: Hex, deadline: bigint, feePool: bigint) {
    return this.write('registerTask', [taskId, deadline, feePool]);
  }

  async claimTask(taskId: Hex) { return this.write('claimTask', [taskId]); }
  async expireTask(taskId: Hex) { return this.write('expireTask', [taskId]); }

  async submitWorkRecord(taskId: Hex, resultHash: Hex, summary: string) {
    return this.write('submitWorkRecord', [taskId, resultHash, summary]);
  }

  async hasWorkRecord(taskId: Hex, agent: Address): Promise<boolean> {
    return this.read('hasWorkRecord', [taskId, agent]);
  }

  async getTask(taskId: Hex): Promise<Task> {
    const raw = await this.read('getTask', [taskId]);
    return {
      creator: raw.creator,
      orchestrator: raw.orchestrator,
      deadline: raw.deadline,
      feePool: raw.feePool,
      delegationCount: raw.delegationCount,
      status: Number(raw.status) as TaskStatus,
    };
  }

  async getDelegationCount(taskId: Hex): Promise<number> {
    return Number(await this.read('getDelegationCount', [taskId]));
  }

  async getTaskDelegations(taskId: Hex): Promise<DelegationHop[]> {
    const raw = await this.read('getTaskDelegations', [taskId]);
    return raw.map((hop: any) => ({
      delegator: hop.delegator,
      delegate: hop.delegate,
      depth: Number(hop.depth),
      delegationHash: hop.delegationHash,
      timestamp: hop.timestamp,
    }));
  }

  async isDelegated(taskId: Hex, agent: Address): Promise<boolean> {
    return this.read('isDelegated', [taskId, agent]);
  }

  async getPromisedFee(taskId: Hex, agent: Address): Promise<bigint> {
    return this.read('getPromisedFee', [taskId, agent]);
  }

  async getTotalPromisedFees(taskId: Hex): Promise<bigint> {
    return this.read('getTotalPromisedFees', [taskId]);
  }

  async getWorkRecord(taskId: Hex, agent: Address): Promise<WorkRecord> {
    const raw = await this.read('getWorkRecord', [taskId, agent]);
    return {
      agent,
      resultHash: raw.resultHash,
      summary: raw.summary,
      submittedAt: raw.timestamp,
    };
  }
}
