import {
  type Hex,
  type Address,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import type { AgentChainClient } from '../client.js';
import type { DemandData } from '../types/index.js';
import { encodeDemand } from './arbiter.js';

/** Alkahest ERC20EscrowObligation ABI (minimal for SDK usage) */
const AlkahestEscrowAbi = [
  {
    name: 'doObligation',
    type: 'function',
    inputs: [
      {
        name: 'data', type: 'tuple',
        components: [
          { name: 'arbiter', type: 'address' },
          { name: 'demand', type: 'bytes' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'expirationTime', type: 'uint64' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'doObligationFor',
    type: 'function',
    inputs: [
      {
        name: 'data', type: 'tuple',
        components: [
          { name: 'arbiter', type: 'address' },
          { name: 'demand', type: 'bytes' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'expirationTime', type: 'uint64' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'collectEscrow',
    type: 'function',
    inputs: [
      { name: 'escrow', type: 'bytes32' },
      { name: 'fulfillment', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'reclaimExpired',
    type: 'function',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export class EscrowModule {
  constructor(private readonly client: AgentChainClient) {}

  private get alkahestAddr() {
    return this.client.addresses.alkahestEscrow;
  }

  /** Encode DemandData for Alkahest escrow demand field. */
  encodeDemand(demand: DemandData): Hex {
    return encodeDemand(demand);
  }

  /** Create Alkahest escrow directly (without going through DelegationTracker).
   *  Caller must approve USDC to the Alkahest escrow contract first. */
  async createEscrow(params: {
    amount: bigint;
    demand: DemandData;
    deadline: bigint;
    recipient?: Address;
  }): Promise<Hex> {
    if (!this.client.walletClient) throw new Error('Wallet client required');

    const demandBytes = this.encodeDemand(params.demand);
    const obligationData = {
      arbiter: this.client.addresses.agentChainArbiter,
      demand: demandBytes,
      token: this.client.addresses.usdc,
      amount: params.amount,
    };

    const fnName = params.recipient ? 'doObligationFor' : 'doObligation';
    const args = params.recipient
      ? [obligationData, params.deadline, params.recipient]
      : [obligationData, params.deadline];

    const hash = await this.client.walletClient.writeContract({
      address: this.alkahestAddr,
      abi: AlkahestEscrowAbi,
      functionName: fnName,
      args,
    } as any);

    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    // The escrow UID is the EAS attestation UID emitted in the logs
    const escrowUid = receipt.logs[0]?.topics?.[1] as Hex;
    return escrowUid;
  }

  /** Collect escrowed funds after fulfillment.
   *  Alkahest calls our Arbiter.checkObligation() to verify. */
  async collectEscrow(escrowUid: Hex, fulfillmentUid: Hex) {
    if (!this.client.walletClient) throw new Error('Wallet client required');

    const hash = await this.client.walletClient.writeContract({
      address: this.alkahestAddr,
      abi: AlkahestEscrowAbi,
      functionName: 'collectEscrow',
      args: [escrowUid, fulfillmentUid],
    } as any);

    return this.client.publicClient.waitForTransactionReceipt({ hash });
  }

  /** Reclaim expired escrow funds. */
  async reclaimExpired(escrowUid: Hex) {
    if (!this.client.walletClient) throw new Error('Wallet client required');

    const hash = await this.client.walletClient.writeContract({
      address: this.alkahestAddr,
      abi: AlkahestEscrowAbi,
      functionName: 'reclaimExpired',
      args: [escrowUid],
    } as any);

    return this.client.publicClient.waitForTransactionReceipt({ hash });
  }
}
