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

  // ─── Task Creation ─────────────────────────────────────

  /** Entry Point A: Register task for delegation-only flow (no Alkahest).
   *  If feePool > 0, caller must approve USDC to DelegationTracker first. */
  async registerTask(params: {
    taskId: Hex;
    deadline: bigint;
    deposit: bigint;
    feePool: bigint;
    intent: string;
  }) {
    return this.write('registerTask', [
      params.taskId, params.deadline, params.deposit, params.feePool, params.intent,
    ]);
  }

  /** Entry Point B: Create task with Alkahest escrow.
   *  Caller must approve USDC to DelegationTracker first.
   *  Returns taskId (= Alkahest escrow UID). */
  async createTask(params: {
    deadline: bigint;
    deposit: bigint;
    stakeThresholdBps: bigint;
    intent: string;
  }): Promise<Hex> {
    const receipt = await this.write('createTask', [
      params.deadline, params.deposit, params.stakeThresholdBps, params.intent,
    ]);
    // taskId is in the return value / event logs
    const taskId = receipt.logs[0]?.topics?.[1] as Hex;
    return taskId;
  }

  // ─── Task Lifecycle ────────────────────────────────────

  async claimTask(taskId: Hex) { return this.write('claimTask', [taskId]); }
  async expireTask(taskId: Hex) { return this.write('expireTask', [taskId]); }

  async submitWorkRecord(taskId: Hex, resultHash: Hex, summary: string) {
    return this.write('submitWorkRecord', [taskId, resultHash, summary]);
  }

  // ─── Read Functions ────────────────────────────────────

  async getTask(taskId: Hex): Promise<Task> {
    const raw = await this.read('getTask', [taskId]);
    return {
      creator: raw.creator,
      orchestrator: raw.orchestrator,
      status: Number(raw.status) as TaskStatus,
      deadline: raw.deadline,
      delegationCount: raw.delegationCount,
      deposit: raw.deposit,
      hasEscrow: raw.hasEscrow,
      intent: raw.intent,
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

  async hasWorkRecord(taskId: Hex, agent: Address): Promise<boolean> {
    return this.read('hasWorkRecord', [taskId, agent]);
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

  async getPromisedFee(taskId: Hex, agent: Address): Promise<bigint> {
    return this.read('getPromisedFee', [taskId, agent]);
  }

  async getTotalPromisedFees(taskId: Hex): Promise<bigint> {
    return this.read('getTotalPromisedFees', [taskId]);
  }
}
