import { type Hex, type Address } from 'viem';
import type { AgentChainClient } from '../client.js';
import { sendWrite, sendBatchWrite } from '../client.js';
import type { DemandData } from '../types/index.js';
import { encodeDemand } from './arbiter.js';

const ERC20_APPROVE_ABI = [
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const;

const AlkahestEscrowAbi = [
  {
    name: 'doObligation', type: 'function',
    inputs: [{
      name: 'data', type: 'tuple',
      components: [
        { name: 'arbiter', type: 'address' },
        { name: 'demand', type: 'bytes' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
    }, { name: 'expirationTime', type: 'uint64' }],
    outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable',
  },
  {
    name: 'doObligationFor', type: 'function',
    inputs: [{
      name: 'data', type: 'tuple',
      components: [
        { name: 'arbiter', type: 'address' },
        { name: 'demand', type: 'bytes' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
    }, { name: 'expirationTime', type: 'uint64' }, { name: 'recipient', type: 'address' }],
    outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable',
  },
  { name: 'collectEscrow', type: 'function', inputs: [{ name: 'escrow', type: 'bytes32' }, { name: 'fulfillment', type: 'bytes32' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'reclaimExpired', type: 'function', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
] as const;

export class EscrowModule {
  constructor(private readonly client: AgentChainClient) {}

  private get alkahestAddr() { return this.client.addresses.alkahestEscrow; }

  encodeDemand(demand: DemandData): Hex { return encodeDemand(demand); }

  /** Create Alkahest escrow. Batches approve + doObligationFor in one UserOp. */
  async createEscrow(params: {
    amount: bigint;
    demand: DemandData;
    deadline: bigint;
    recipient?: Address;
  }): Promise<Hex> {
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

    return sendBatchWrite(this.client, [
      { to: this.client.addresses.usdc, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [this.alkahestAddr, params.amount] },
      { to: this.alkahestAddr, abi: AlkahestEscrowAbi, functionName: fnName, args },
    ]);
  }

  async collectEscrow(escrowUid: Hex, fulfillmentUid: Hex): Promise<Hex> {
    return sendWrite(this.client, this.alkahestAddr, AlkahestEscrowAbi, 'collectEscrow', [escrowUid, fulfillmentUid]);
  }

  async reclaimExpired(escrowUid: Hex): Promise<Hex> {
    return sendWrite(this.client, this.alkahestAddr, AlkahestEscrowAbi, 'reclaimExpired', [escrowUid]);
  }
}
