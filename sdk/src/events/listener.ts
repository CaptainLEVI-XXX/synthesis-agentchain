import type { AgentChainClient } from '../client.js';
import type {
  TaskEvent,
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

  onTaskRegistered(callback: (event: TaskEvent) => void): () => void {
    const unwatch = this.client.publicClient.watchContractEvent({
      address: this.client.addresses.delegationTracker,
      abi: DelegationTrackerAbi,
      eventName: 'TaskRegistered',
      onLogs: (logs) => {
        for (const log of logs) {
          const args = (log as any).args;
          callback({
            taskId: args.taskId,
            creator: args.creator,
            deadline: args.deadline,
            feePool: args.feePool ?? 0n,
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
    callback: (event: TaskEvent) => void,
  ): () => void {
    // Listen for all task events — capability filtering happens at the
    // application layer since task events don't include capability data.
    // The SDK consumer should use discovery.discover() to match agents.
    return this.onTaskRegistered(callback);
  }
}
