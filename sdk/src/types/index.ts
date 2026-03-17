import type { Address, Hex } from 'viem';

// ─── Agent Registry Types ────────────────────────────────

export type AgentInfo = {
  address: Address;
  name: string;
  endpoint: string;
  erc8004Id: bigint;
  ensName: string;
  registeredAt: bigint;
  active: boolean;
  stake: bigint;
  capabilityHashes: Hex[];
};

// ─── Task / Tracker Types ────────────────────────────────

export enum TaskStatus {
  Open = 0,
  Accepted = 1,
  Completed = 2,
  Expired = 3,
}

export type Task = {
  creator: Address;
  orchestrator: Address;
  deadline: bigint;
  feePool: bigint;
  delegationCount: bigint;
  status: TaskStatus;
};

export type DelegationHop = {
  delegator: Address;
  delegate: Address;
  depth: number;
  delegationHash: Hex;
  timestamp: bigint;
};

export type WorkRecord = {
  agent: Address;
  resultHash: Hex;
  summary: string;
  submittedAt: bigint;
};

// ─── Arbiter / Escrow Types ──────────────────────────────

export type DemandData = {
  taskId: Hex;
  orchestrator: Address;
  stakeThresholdBps: bigint;
  minReputation: bigint;
  reputationRequired: boolean;
};

// ─── Delegation Types ────────────────────────────────────

export type AgentTerms = {
  taskId: Hex;
  maxDepth: number;
  currentDepth: number;
  minStake: bigint;
  fee: bigint;
  requiredCaps: Hex[];
};

export type Caveat = {
  enforcer: Address;
  terms: Hex;
};

export type SignedDelegation = {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
};

// ─── Relay Types ─────────────────────────────────────────

export type Proposal = {
  taskId: Hex;
  agent: Address;
  strategy: string;
  fee: bigint;
  signature: Hex;
  timestamp: number;
};

// ─── Olas Types ──────────────────────────────────────────

export type MechInfo = {
  id: string;
  capabilities: string[];
  price: bigint;
};

export type MechResult = {
  output: string;
  txHash?: Hex;
};

// ─── Event Types ─────────────────────────────────────────

export type TaskEvent = {
  taskId: Hex;
  creator: Address;
  deadline: bigint;
  feePool: bigint;
};

export type TaskAcceptedEvent = {
  taskId: Hex;
  orchestrator: Address;
};

export type DelegationEvent = {
  taskId: Hex;
  delegator: Address;
  delegate: Address;
  depth: number;
  delegationHash: Hex;
};

export type WorkEvent = {
  taskId: Hex;
  agent: Address;
  resultHash: Hex;
};

// ─── Config Types ────────────────────────────────────────

export type ContractAddresses = {
  agentRegistry: Address;
  delegationTracker: Address;
  agentChainArbiter: Address;
  agentCapabilityEnforcer: Address;
  usdc: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  delegationManager: Address;
  simpleFactory: Address;
};

export type AgentChainConfig = {
  chain: 'base' | 'baseSepolia';
  rpcUrl?: string;
  privateKey?: Hex;
  contracts?: Partial<ContractAddresses>;
};

// ─── Error Types ─────────────────────────────────────────

export class AgentChainError extends Error {
  constructor(
    public code: string,
    public contract: string,
    public params?: Record<string, unknown>,
  ) {
    super(`${contract}: ${code}`);
    this.name = 'AgentChainError';
  }
}
