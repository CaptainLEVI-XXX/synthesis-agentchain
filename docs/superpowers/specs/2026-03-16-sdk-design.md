# AgentChain SDK (`@agentchain/sdk`) — Design Spec

**Date:** 2026-03-16
**Approach:** Modular with facade (Approach 2)
**Tech Stack:** TypeScript, viem, vitest

## Overview

TypeScript SDK wrapping all 4 AgentChain contracts + external protocol integrations (MetaMask Delegation, Alkahest Escrow, ERC-8004, Olas). Provides a clean API for three personas: Users (EOA task creators), Orchestrators (smart account agents), and Sub-agents (specialist workers).

## Architecture

Independent modules that each own one responsibility. A thin `AgentChain` facade re-exports them for convenience. Consumers can import individual modules or use the facade.

```
sdk/
├── package.json              # @agentchain/sdk
├── tsconfig.json
├── src/
│   ├── index.ts              # AgentChain facade class + re-exports
│   ├── client.ts             # Shared config: chain, RPC, signer, contract addresses
│   ├── core/
│   │   ├── registry.ts       # AgentRegistry: register, stake, capabilities (string<>bytes32)
│   │   ├── discovery.ts      # Agent search by capability + ERC-8004 reputation filter
│   │   ├── delegation.ts     # MetaMask delegation creation, caveat composition, depth tracking
│   │   ├── accounts.ts       # HybridDeleGator smart account creation via SimpleFactory
│   │   ├── escrow.ts         # Alkahest escrow: makeStatement, collectPayment (minimal interface)
│   │   ├── reputation.ts     # ERC-8004 Reputation Registry: getSummary, giveFeedback
│   │   ├── tracker.ts        # DelegationTracker: tasks, delegations, work records
│   │   ├── arbiter.ts        # AgentChainArbiter: settleAndRate, disputeAgent, checkStatement
│   │   └── olas-bridge.ts    # Olas mech-client wrapper
│   ├── relay/
│   │   └── proposals.ts      # Off-chain proposal relay client (EIP-712 signed)
│   ├── events/
│   │   ├── listener.ts       # On-chain event watchers (viem watchContractEvent)
│   │   └── filters.ts        # Filter events by capability match
│   ├── types/
│   │   └── index.ts          # TypeScript types, EIP-712 definitions
│   └── abis/
│       ├── AgentRegistry.ts
│       ├── DelegationTracker.ts
│       ├── AgentChainArbiter.ts
│       ├── AgentCapabilityEnforcer.ts
│       └── external/         # ERC-8004, DelegationManager, SimpleFactory, Alkahest ABIs
├── test/
│   ├── registry.test.ts
│   ├── tracker.test.ts
│   ├── arbiter.test.ts
│   ├── delegation.test.ts
│   ├── discovery.test.ts
│   ├── escrow.test.ts
│   ├── reputation.test.ts
│   ├── accounts.test.ts
│   ├── olas-bridge.test.ts
│   ├── relay.test.ts
│   ├── events.test.ts
│   └── integration.test.ts  # Full flow against Anvil fork
└── README.md
```

## Shared Config — `client.ts`

```typescript
import { createPublicClient, createWalletClient, http, Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export type AgentChainConfig = {
  chain: 'base' | 'baseSepolia';
  rpcUrl?: string;
  account: PrivateKeyAccount | WalletClient;
  contracts?: Partial<ContractAddresses>;
};

export type ContractAddresses = {
  agentRegistry: Address;
  delegationTracker: Address;
  agentChainArbiter: Address;
  agentCapabilityEnforcer: Address;
  // External (defaults per chain)
  usdc: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  delegationManager: Address;
  simpleFactory: Address;
};

// Default addresses for Base mainnet
export const BASE_ADDRESSES: ContractAddresses = {
  agentRegistry: '0x...', // filled after deployment
  delegationTracker: '0x...',
  agentChainArbiter: '0x...',
  agentCapabilityEnforcer: '0x...',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
  simpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c',
};

export function createAgentChainClient(config: AgentChainConfig) {
  // Returns { publicClient, walletClient, addresses }
}
```

## Module APIs

### `core/registry.ts` — AgentRegistry Interactions

Handles agent registration, staking, capability management. All methods that accept capability strings convert them to `bytes32` hashes internally via `capToBytes32()`. The reverse mapping (bytes32 to string) is not possible on-chain; `getAgent()` returns `capabilityHashes: Hex[]` as raw bytes32.

```typescript
export class RegistryModule {
  constructor(client: AgentChainClient);

  // Registration — capabilities: string[] converted to bytes32[] internally
  registerAndStake(params: {
    name: string;
    erc8004Id: bigint;
    capabilities: string[];
    endpoint: string;
    stakeAmount: bigint;
  }): Promise<TransactionReceipt>;

  register(params: {
    name: string;
    erc8004Id: bigint;
    capabilities: string[];
    endpoint: string;
  }): Promise<TransactionReceipt>;

  // Staking
  addStake(amount: bigint): Promise<TransactionReceipt>;
  unstake(amount: bigint): Promise<TransactionReceipt>;

  // Updates — capabilities converted to bytes32[] internally
  updateCapabilities(capabilities: string[]): Promise<TransactionReceipt>;
  updateEndpoint(endpoint: string): Promise<TransactionReceipt>;
  linkENSName(ensName: string): Promise<TransactionReceipt>;
  deactivate(): Promise<TransactionReceipt>;

  // Reads
  getAgent(address: Address): Promise<AgentInfo>;
  getAgentsByCapability(capability: string): Promise<Address[]>;
  stakes(address: Address): Promise<bigint>;
  isRegistered(address: Address): Promise<boolean>;
  hasCapabilities(address: Address, capabilities: string[]): Promise<boolean>;
}

// Internal helper — used by all methods that accept capability strings
export function capToBytes32(cap: string): Hex {
  return keccak256(encodePacked(['string'], [cap]));
}
```

### `core/tracker.ts` — DelegationTracker Interactions

Task lifecycle management, delegation recording, work records.

Note: `submitWorkRecord()` requires the caller to be a delegated agent for the task (enforced by `onlyDelegatedAgent` modifier). `isDelegated()` reads a public mapping on the contract.

```typescript
export class TrackerModule {
  constructor(client: AgentChainClient);

  // Task lifecycle
  registerTask(taskId: Hex, deadline: bigint, feePool: bigint): Promise<TransactionReceipt>;
  claimTask(taskId: Hex): Promise<TransactionReceipt>;
  expireTask(taskId: Hex): Promise<TransactionReceipt>;

  // Work records (caller must be delegated agent for the task)
  submitWorkRecord(taskId: Hex, resultHash: Hex, summary: string): Promise<TransactionReceipt>;
  hasWorkRecord(taskId: Hex, agent: Address): Promise<boolean>;

  // Reads
  getTask(taskId: Hex): Promise<Task>;
  getDelegationCount(taskId: Hex): Promise<number>;
  getTaskDelegations(taskId: Hex): Promise<DelegationHop[]>;
  isDelegated(taskId: Hex, agent: Address): Promise<boolean>;  // reads public mapping
  getPromisedFee(taskId: Hex, agent: Address): Promise<bigint>;
  getTotalPromisedFees(taskId: Hex): Promise<bigint>;
}
```

### `core/arbiter.ts` — AgentChainArbiter Interactions

Settlement, reputation feedback, and dispute functions on the AgentChainArbiter contract. Also exposes `checkStatement()` for off-chain verification previews.

```typescript
export class ArbiterModule {
  constructor(client: AgentChainClient);

  // Settlement — only callable by task creator
  settleAndRate(taskId: Hex, rating: bigint): Promise<TransactionReceipt>;

  // Disputes — only callable by task creator
  disputeAgent(params: {
    taskId: Hex;
    agentAddress: Address;
    feedbackURI: string;
    feedbackHash: Hex;
  }): Promise<TransactionReceipt>;

  // Verification preview (view function)
  checkStatement(demand: DemandData): Promise<boolean>;
}
```

### `core/delegation.ts` — MetaMask Delegation Composition

Creates MetaMask delegations with composed caveats (our custom enforcer + 5 built-in enforcers). Requires SimpleFactory and HybridDeleGator ABIs from `abis/external/`.

Note: `requiredCaps` accepts `string[]` and converts to `bytes32[]` internally via `capToBytes32()` before encoding into `AgentTerms`. `maxDepth` and `currentDepth` are constrained to 0-255 (uint8 in Solidity).

```typescript
export class DelegationModule {
  constructor(client: AgentChainClient);

  createDelegation(params: {
    to: Address;
    taskId: Hex;
    budget: bigint;
    targets: Address[];
    methods: string[];
    maxDepth: number;       // uint8: 0-255
    currentDepth: number;   // uint8: 0-255
    minStake: bigint;
    fee: bigint;
    requiredCaps: string[]; // converted to bytes32[] internally
    expiry: number;
    maxCalls?: number;
  }): Promise<SignedDelegation>;

  // Encodes AgentTerms struct for our custom enforcer
  // requiredCaps must already be bytes32 hashes at this level
  encodeAgentTerms(terms: AgentTerms): Hex;

  // Composes caveat array: AgentCapabilityEnforcer + built-in enforcers
  composeCaveats(params: DelegationParams): Caveat[];
}
```

### `core/accounts.ts` — Smart Account Creation

Deploys HybridDeleGator smart accounts via SimpleFactory (`0x69Aa2f...`). Requires SimpleFactory and HybridDeleGator ABIs from `abis/external/`.

```typescript
export class AccountsModule {
  constructor(client: AgentChainClient);

  createAgentAccount(params: {
    signer: PrivateKeyAccount;
    salt?: bigint;
  }): Promise<{ address: Address; account: SmartAccount }>;

  getAccountAddress(signer: Address, salt?: bigint): Promise<Address>;
}
```

### `core/escrow.ts` — Alkahest Escrow (Minimal Interface)

Built against a minimal interface. Wired to real Alkahest when ABIs are available. `taskId` is extracted by parsing the EAS `Attested` event log from the `makeStatement()` transaction receipt.

```typescript
export class EscrowModule {
  constructor(client: AgentChainClient);

  createEscrow(params: {
    token: Address;
    amount: bigint;
    arbiter: Address;
    demand: DemandData;
    deadline: number;
  }): Promise<{ taskId: Hex; tx: TransactionReceipt }>;
  // taskId extracted from EAS Attested event in the tx receipt

  collectPayment(taskId: Hex): Promise<TransactionReceipt>;

  // Encode DemandData for the arbiter
  encodeDemand(demand: DemandData): Hex;
}
```

### `core/reputation.ts` — ERC-8004 Reputation Registry

Reads reputation data from the canonical ERC-8004 Reputation Registry. `getSummary()` internally calls `getClients()` first to get the client list, then passes it to the contract's `getSummary(agentId, clients, tag1, tag2)`.

```typescript
export class ReputationModule {
  constructor(client: AgentChainClient);

  // Internally calls getClients() first, then contract getSummary(id, clients, tag1, tag2)
  getSummary(erc8004Id: bigint, tag?: string): Promise<{
    count: bigint;
    avgRating: bigint;       // int128 in contract — signed, 1 decimal (45 = 4.5)
    decimals: number;        // summaryValueDecimals from contract
  }>;

  getClients(erc8004Id: bigint): Promise<Address[]>;
}
```

### `core/discovery.ts` — Agent Discovery

Combines AgentRegistry capability search + ERC-8004 reputation filtering + Olas fallback.

```typescript
export class DiscoveryModule {
  constructor(
    client: AgentChainClient,
    registry: RegistryModule,
    reputation: ReputationModule,
    olas: OlasBridgeModule,
  );

  discover(params: {
    capability: string;
    minReputation?: number;
    minStake?: bigint;
    sources?: ('agentchain' | 'olas')[];
  }): Promise<AgentInfo[]>;
}
```

### `core/olas-bridge.ts` — Olas Marketplace

Wraps mech-client for Olas marketplace integration.

```typescript
export class OlasBridgeModule {
  discoverMechs(capability: string): Promise<MechInfo[]>;
  hireMech(task: TaskSpec): Promise<MechResult>;
}
```

### `relay/proposals.ts` — Off-chain Proposal Relay

EIP-712 signed proposals stored on off-chain relay server. This is an alternative flow to the autonomous `claimTask()` model — both exist. `claimTask()` is for autonomous agents. Proposals are for orchestrators that want to present a strategy for user review before claiming. The relay is optional; the core protocol works without it.

```typescript
export class RelayModule {
  constructor(client: AgentChainClient, relayUrl: string);

  submitProposal(params: {
    taskId: Hex;
    strategy: string;
    fee: bigint;
  }): Promise<void>;

  getProposals(taskId: Hex): Promise<Proposal[]>;
}
```

### `events/listener.ts` — On-chain Event Watchers

Uses viem `watchContractEvent` for real-time event streaming.

```typescript
export class EventsModule {
  constructor(client: AgentChainClient);

  onTaskRegistered(callback: (task: TaskEvent) => void): () => void;
  onTaskAccepted(callback: (task: TaskAcceptedEvent) => void): () => void;
  onDelegationRecorded(callback: (hop: DelegationEvent) => void): () => void;
  onWorkCompleted(callback: (work: WorkEvent) => void): () => void;

  // Filtered listener — only fires for tasks matching capabilities
  onTaskForCapability(
    capability: string,
    callback: (task: TaskEvent) => void,
  ): () => void;
}
```

### `index.ts` — AgentChain Facade

```typescript
export class AgentChain {
  readonly registry: RegistryModule;
  readonly tracker: TrackerModule;
  readonly arbiter: ArbiterModule;
  readonly delegation: DelegationModule;
  readonly accounts: AccountsModule;
  readonly escrow: EscrowModule;
  readonly reputation: ReputationModule;
  readonly discovery: DiscoveryModule;
  readonly olas: OlasBridgeModule;
  readonly relay: RelayModule;
  readonly events: EventsModule;

  static create(config: AgentChainConfig): AgentChain;
}
```

## Types — `types/index.ts`

```typescript
export type AgentInfo = {
  address: Address;
  name: string;
  endpoint: string;
  erc8004Id: bigint;
  ensName: string;
  registeredAt: bigint;
  active: boolean;
  stake: bigint;
  capabilityHashes: Hex[];  // bytes32[] from contract — reverse mapping not possible on-chain
};

export type Task = {
  creator: Address;
  orchestrator: Address;
  deadline: bigint;
  feePool: bigint;
  delegationCount: bigint;  // matches contract Task struct field
  status: TaskStatus;
};

export enum TaskStatus {
  Open = 0,
  Accepted = 1,
  Completed = 2,
  Expired = 3,
}

export type DelegationHop = {
  delegator: Address;
  delegate: Address;
  depth: number;          // uint8 in contract: 0-255
  delegationHash: Hex;
  timestamp: bigint;
};

export type DemandData = {
  taskId: Hex;
  orchestrator: Address;
  stakeThresholdBps: bigint;  // uint256 in contract
  minReputation: bigint;      // int128 in contract (signed, 1 decimal: 45 = 4.5)
  reputationRequired: boolean;
};

export type AgentTerms = {
  taskId: Hex;
  maxDepth: number;       // uint8: 0-255
  currentDepth: number;   // uint8: 0-255
  minStake: bigint;
  fee: bigint;
  requiredCaps: Hex[];    // bytes32[] — already hashed
};

export type Proposal = {
  taskId: Hex;
  agent: Address;
  strategy: string;
  fee: bigint;
  signature: Hex;
  timestamp: number;
};

export type SignedDelegation = {
  delegation: Delegation;
  signature: Hex;
};

export type MechInfo = {
  id: string;
  capabilities: string[];
  price: bigint;
};

export type MechResult = {
  output: string;
  txHash?: Hex;
};
```

## ABIs

ABIs are extracted from Foundry artifacts (`contracts/out/`) and stored as TypeScript const arrays for viem type safety. A build script copies them:

```bash
# sdk/scripts/extract-abis.sh
cp contracts/out/AgentRegistry.sol/AgentRegistry.json sdk/src/abis/
cp contracts/out/DelegationTracker.sol/DelegationTracker.json sdk/src/abis/
cp contracts/out/AgentChainArbiter.sol/AgentChainArbiter.json sdk/src/abis/
cp contracts/out/AgentCapabilityEnforcer.sol/AgentCapabilityEnforcer.json sdk/src/abis/
```

External ABIs (`abis/external/`): minimal interfaces for ERC-8004 Identity Registry, ERC-8004 Reputation Registry, MetaMask DelegationManager, SimpleFactory, HybridDeleGator, and Alkahest ERC20EscrowObligation. Only the functions we call are included.

## Error Handling

- All contract calls wrapped with viem's typed error decoding (`decodeErrorResult`)
- Custom `AgentChainError` class:
  ```typescript
  class AgentChainError extends Error {
    constructor(
      public code: string,
      public contract: string,
      public params?: Record<string, unknown>,
    ) { super(`${contract}: ${code}`); }
  }
  ```
- Contract-specific errors decoded from custom error selectors (e.g., `AgentNotRegistered`, `StakeInsufficient`)
- Network errors (RPC timeout, nonce, gas) surfaced cleanly

## Dependencies

```json
{
  "dependencies": {
    "viem": "^2.0.0"
  },
  "optionalDependencies": {
    "mech-client": "*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0"
  }
}
```

Note: MetaMask delegation encoding is done manually via ABI encoding (using viem's `encodeAbiParameters`), not via a MetaMask JS SDK dependency. The SimpleFactory and HybridDeleGator ABIs are included in `abis/external/`.

## Testing Strategy

- **Unit tests** per module with mocked viem clients (vitest mock)
- **Integration test** against Anvil fork of Base mainnet
- Key test cases:
  - Capability string to bytes32 round-trip
  - AgentTerms encoding matches Solidity abi.decode
  - Caveat composition produces correct array
  - Event filtering by capability
  - Full task lifecycle on fork
  - Arbiter settleAndRate and disputeAgent flows
  - Escrow taskId extraction from EAS event logs
