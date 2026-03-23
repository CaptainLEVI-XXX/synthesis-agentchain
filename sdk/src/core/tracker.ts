import { type Address, type Hex } from 'viem';
import { DelegationTrackerAbi } from '../abis/DelegationTracker.js';
import { TaskStatus, type Task, type DelegationHop, type WorkRecord } from '../types/index.js';
import type { AgentChainClient } from '../client.js';
import { sendWrite, sendBatchWrite } from '../client.js';

const ERC20_APPROVE_ABI = [
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const;

export class TrackerModule {
  constructor(private readonly client: AgentChainClient) {}

  private get addr() {
    return this.client.addresses.delegationTracker;
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
   *  Batches USDC approval + registerTask in a single UserOp. */
  async registerTask(params: {
    taskId: Hex;
    deadline: bigint;
    deposit: bigint;
    feePool: bigint;
    intent: string;
  }): Promise<Hex> {
    if (params.feePool > 0n) {
      return sendBatchWrite(this.client, [
        { to: this.client.addresses.usdc, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [this.addr, params.feePool] },
        { to: this.addr, abi: DelegationTrackerAbi, functionName: 'registerTask', args: [params.taskId, params.deadline, params.deposit, params.feePool, params.intent] },
      ]);
    }
    return sendWrite(this.client, this.addr, DelegationTrackerAbi, 'registerTask', [
      params.taskId, params.deadline, params.deposit, params.feePool, params.intent,
    ]);
  }

  /** Entry Point B: Create task with Alkahest escrow.
   *  Batches USDC approval + createTask. Returns taskId from logs. */
  async createTask(params: {
    deadline: bigint;
    deposit: bigint;
    stakeThresholdBps: bigint;
    intent: string;
  }): Promise<Hex> {
    const txHash = await sendBatchWrite(this.client, [
      { to: this.client.addresses.usdc, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [this.addr, params.deposit] },
      { to: this.addr, abi: DelegationTrackerAbi, functionName: 'createTask', args: [params.deadline, params.deposit, params.stakeThresholdBps, params.intent] },
    ]);
    // TODO: parse taskId from event logs
    return txHash;
  }

  // ─── Task Lifecycle ────────────────────────────────────

  async claimTask(taskId: Hex): Promise<Hex> {
    return sendWrite(this.client, this.addr, DelegationTrackerAbi, 'claimTask', [taskId]);
  }

  async expireTask(taskId: Hex): Promise<Hex> {
    return sendWrite(this.client, this.addr, DelegationTrackerAbi, 'expireTask', [taskId]);
  }

  async submitWorkRecord(taskId: Hex, resultHash: Hex, summary: string): Promise<Hex> {
    return sendWrite(this.client, this.addr, DelegationTrackerAbi, 'submitWorkRecord', [taskId, resultHash, summary]);
  }

  // ─── Read Functions (unchanged) ────────────────────────

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
    return { agent, resultHash: raw.resultHash, summary: raw.summary, submittedAt: raw.timestamp };
  }

  async getPromisedFee(taskId: Hex, agent: Address): Promise<bigint> {
    return this.read('getPromisedFee', [taskId, agent]);
  }

  async getTotalPromisedFees(taskId: Hex): Promise<bigint> {
    return this.read('getTotalPromisedFees', [taskId]);
  }
}
