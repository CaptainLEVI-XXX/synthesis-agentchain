import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import type { BatchCall } from './types.js';

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

/**
 * Encodes batch calls for execution via a smart account.
 * Uses tuple array encoding: (address target, uint256 value, bytes callData)[]
 */
export function encodeBatchCalls(calls: BatchCall[]): Hex {
  const tuples = calls.map((call) => ({
    target: call.to,
    value: call.value ?? 0n,
    callData: call.data,
  }));

  return encodeAbiParameters(
    parseAbiParameters('(address target, uint256 value, bytes callData)[]'),
    [tuples],
  );
}

export function buildApproveCall(
  token: Address,
  spender: Address,
  amount: bigint,
): BatchCall {
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender, amount],
  });
  return { to: token, data };
}

export function buildSwapCalldata(
  router: Address,
  swapData: Hex,
  value?: bigint,
): BatchCall {
  return { to: router, data: swapData, value };
}
