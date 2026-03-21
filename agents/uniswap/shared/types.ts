import type { Address, Hex } from 'viem';

// ─── HTTP API Types ──────────────────────────────────────

/** Request sent from orchestrator to sub-agent */
export interface TaskRequest {
  taskId: Hex;
  subIntent: string;           // what the orchestrator wants this agent to do
  delegationData?: {           // MetaMask delegation (if applicable)
    delegation: any;           // signed delegation struct
    terms: any;                // AgentTerms
  };
  callerAddress: Address;      // orchestrator's address
  callerEndpoint: string;      // orchestrator's callback URL
}

/** Response from sub-agent after completing work */
export interface TaskResponse {
  taskId: Hex;
  success: boolean;
  resultHash: Hex;             // keccak256 of the result (for work record)
  summary: string;             // human-readable summary
  data?: Record<string, any>;  // structured result data
  txHash?: Hex;                // on-chain TxID if applicable
  error?: string;              // error message if failed
}

/** Agent info returned by /info endpoint */
export interface AgentInfoResponse {
  name: string;
  address: Address;
  capabilities: string[];
  endpoint: string;
  minFee: string;              // minimum fee in USDC (6 decimals)
  stake: string;               // current stake in USDC
  status: 'ready' | 'busy' | 'offline';
}

/** Health check response */
export interface HealthResponse {
  status: 'ok' | 'error';
  name: string;
  uptime: number;
  tasksCompleted: number;
}

// ─── Agent Config ────────────────────────────────────────

export interface AgentServerConfig {
  name: string;
  port: number;
  privateKey: Hex;
  capabilities: string[];
  minFee: bigint;
  rpcUrl: string;
  chain: 'base' | 'baseSepolia';
}
