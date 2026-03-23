/**
 * Helper for creating and signing MetaMask Delegations.
 * Implements EIP-712 typed data signing compatible with DelegationManager.
 */

import {
  type Address,
  type Hex,
  keccak256,
  encodeAbiParameters,
  encodePacked,
  encodeFunctionData,
  type WalletClient,
} from 'viem';
import { EXTERNAL, CONTRACTS } from './config.js';

// ─── EIP-712 Types ───────────────────────────────────────

const DELEGATION_TYPEHASH = keccak256(
  encodePacked(['string'], [
    'Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)',
  ]),
);

const CAVEAT_TYPEHASH = keccak256(
  encodePacked(['string'], ['Caveat(address enforcer,bytes terms)']),
);

const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;

export type Caveat = {
  enforcer: Address;
  terms: Hex;
};

export type Delegation = {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
};

// ─── Encoding ────────────────────────────────────────────

function hashCaveat(caveat: Caveat): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }],
      [CAVEAT_TYPEHASH, caveat.enforcer, keccak256(caveat.terms)],
    ),
  );
}

function hashCaveatArray(caveats: Caveat[]): Hex {
  const hashes = caveats.map(hashCaveat);
  return keccak256(encodePacked(['bytes32[]'], [hashes]));
}

export function getDelegationHash(delegation: Omit<Delegation, 'signature'>): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      [
        DELEGATION_TYPEHASH,
        delegation.delegate,
        delegation.delegator,
        delegation.authority,
        hashCaveatArray(delegation.caveats),
        delegation.salt,
      ],
    ),
  );
}

// ─── AgentTerms Encoding ─────────────────────────────────

export function encodeAgentTerms(params: {
  taskId: Hex;
  maxDepth: number;
  currentDepth: number;
  minStake: bigint;
  fee: bigint;
  requiredCaps: Hex[];
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'taskId', type: 'bytes32' },
          { name: 'maxDepth', type: 'uint8' },
          { name: 'currentDepth', type: 'uint8' },
          { name: 'minStake', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'requiredCaps', type: 'bytes32[]' },
        ],
      },
    ],
    [
      {
        taskId: params.taskId,
        maxDepth: params.maxDepth,
        currentDepth: params.currentDepth,
        minStake: params.minStake,
        fee: params.fee,
        requiredCaps: params.requiredCaps,
      },
    ],
  );
}

// ─── Create + Sign Delegation ────────────────────────────

export async function createSignedDelegation(
  walletClient: WalletClient,
  params: {
    delegate: Address;
    delegator: Address;  // smart account address
    taskId: Hex;
    maxDepth: number;
    currentDepth: number;
    minStake: bigint;
    fee: bigint;
    requiredCaps: Hex[];
    salt?: bigint;
  },
): Promise<Delegation> {
  const terms = encodeAgentTerms({
    taskId: params.taskId,
    maxDepth: params.maxDepth,
    currentDepth: params.currentDepth,
    minStake: params.minStake,
    fee: params.fee,
    requiredCaps: params.requiredCaps,
  });

  const caveat: Caveat = {
    enforcer: CONTRACTS.agentCapabilityEnforcer,
    terms,
  };

  const salt = params.salt ?? BigInt(Date.now());

  const delegation: Omit<Delegation, 'signature'> = {
    delegate: params.delegate,
    delegator: params.delegator,
    authority: ROOT_AUTHORITY,
    caveats: [caveat],
    salt,
  };

  // Sign using EIP-712 typed data
  // The DelegationManager verifies this against the delegator (smart account)
  // The smart account's isValidSignature checks the EOA owner's ECDSA sig
  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: {
      name: 'DelegationManager',
      version: '1',
      chainId: 84532, // Base Sepolia
      verifyingContract: EXTERNAL.delegationManager,
    },
    types: {
      Delegation: [
        { name: 'delegate', type: 'address' },
        { name: 'delegator', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        { name: 'caveats', type: 'Caveat[]' },
        { name: 'salt', type: 'uint256' },
      ],
      Caveat: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
      ],
    },
    primaryType: 'Delegation',
    message: {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: delegation.caveats.map(c => ({
        enforcer: c.enforcer,
        terms: c.terms,
      })),
      salt: delegation.salt,
    },
  });

  return { ...delegation, signature };
}

// ─── Encode for redeemDelegations ────────────────────────

export function encodePermissionContext(delegations: Delegation[]): Hex {
  // Encode as Delegation[] — ordered leaf to root
  const tuples = delegations.map(d => ({
    delegate: d.delegate,
    delegator: d.delegator,
    authority: d.authority,
    caveats: d.caveats.map(c => ({
      enforcer: c.enforcer,
      terms: c.terms,
      args: '0x' as Hex,  // empty args
    })),
    salt: d.salt,
    signature: d.signature,
  }));

  return encodeAbiParameters(
    [{
      type: 'tuple[]',
      components: [
        { name: 'delegate', type: 'address' },
        { name: 'delegator', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        {
          name: 'caveats', type: 'tuple[]',
          components: [
            { name: 'enforcer', type: 'address' },
            { name: 'terms', type: 'bytes' },
            { name: 'args', type: 'bytes' },
          ],
        },
        { name: 'salt', type: 'uint256' },
        { name: 'signature', type: 'bytes' },
      ],
    }],
    [tuples],
  );
}

// ─── DelegationManager ABI ───────────────────────────────

export const DelegationManagerAbi = [
  {
    name: 'redeemDelegations',
    type: 'function',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getDelegationHash',
    type: 'function',
    inputs: [{
      name: '_delegation', type: 'tuple',
      components: [
        { name: 'delegate', type: 'address' },
        { name: 'delegator', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        {
          name: 'caveats', type: 'tuple[]',
          components: [
            { name: 'enforcer', type: 'address' },
            { name: 'terms', type: 'bytes' },
            { name: 'args', type: 'bytes' },
          ],
        },
        { name: 'salt', type: 'uint256' },
        { name: 'signature', type: 'bytes' },
      ],
    }],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    name: 'getDomainHash',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const;

// ─── Execution Encoding ──────────────────────────────────

// ModeCode for single default execution
export const SINGLE_DEFAULT_MODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

// Encode a single execution (target + value + calldata) for redeemDelegations
export function encodeExecution(target: Address, value: bigint, callData: Hex): Hex {
  return encodeAbiParameters(
    [{
      type: 'tuple[]',
      components: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'callData', type: 'bytes' },
      ],
    }],
    [[{ target, value, callData }]],
  );
}
