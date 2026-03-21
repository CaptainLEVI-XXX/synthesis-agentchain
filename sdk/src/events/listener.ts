import type { AgentChainClient } from '../client.js';
import type {
  TaskCreatedEvent,
  TaskAcceptedEvent,
  DelegationEvent,
  WorkEvent,
} from '../types/index.js';
import { DelegationTrackerAbi } from '../abis/DelegationTracker.js';

export class EventsModule {
  private client: AgentChainClient;

  constructor(client: AgentChainClient) {
    this.client = client;
  }

  onTaskCreated(callback: (event: TaskCreatedEvent) => void): () => void {
    const unwatch = this.client.publicClient.watchContractEvent({
      address: this.client.addresses.delegationTracker,
      abi: DelegationTrackerAbi,
      eventName: 'TaskCreated' as any,  // ABI may still have 'TaskRegistered' — updated on next ABI regen
      onLogs: (logs) => {
        for (const log of logs) {
          const args = (log as any).args;
          callback({
            taskId: args.taskId,
            creator: args.creator,
            deposit: args.deposit ?? 0n,
            deadline: args.deadline,
            intent: args.intent ?? '',
          });
        }
      },
    });
    return unwatch;
  }

  onTaskAccepted(callback: (event: TaskAcceptedEvent) => void): () => void {
    const unwatch = this.client.publicClient.watchContractEvent({
      address: this.client.addresses.delegationTracker,
      abi: DelegationTrackerAbi,
      eventName: 'TaskAccepted',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = (log as any).args;
          callback({
            taskId: args.taskId,
            orchestrator: args.orchestrator,
          });
        }
      },
    });
    return unwatch;
  }

  onDelegationRecorded(callback: (event: DelegationEvent) => void): () => void {
    const unwatch = this.client.publicClient.watchContractEvent({
      address: this.client.addresses.delegationTracker,
      abi: DelegationTrackerAbi,
      eventName: 'DelegationCreated',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = (log as any).args;
          callback({
            taskId: args.taskId,
            delegator: args.delegator,
            delegate: args.delegate,
            depth: Number(args.depth),
            delegationHash: args.delegationHash,
            fee: args.fee ?? 0n,
          });
        }
      },
    });
    return unwatch;
  }

  onWorkCompleted(callback: (event: WorkEvent) => void): () => void {
    const unwatch = this.client.publicClient.watchContractEvent({
      address: this.client.addresses.delegationTracker,
      abi: DelegationTrackerAbi,
      eventName: 'WorkCompleted',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = (log as any).args;
          callback({
            taskId: args.taskId,
            agent: args.agent,
            resultHash: args.resultHash,
          });
        }
      },
    });
    return unwatch;
  }

  onTaskForCapability(
    _capability: string,
    callback: (event: TaskCreatedEvent) => void,
  ): () => void {
    // Listen for all task events — capability filtering happens at the
    // application layer since task events don't include capability data.
    return this.onTaskCreated(callback);
  }
}
