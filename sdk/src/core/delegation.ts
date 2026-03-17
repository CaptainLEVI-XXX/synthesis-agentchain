import {
  type Address,
  type Hex,
  encodeAbiParameters,
  keccak256,
  encodePacked,
  concat,
  toHex,
} from 'viem';
import type {
  AgentTerms,
  Caveat,
  SignedDelegation,
} from '../types/index.js';
import type { AgentChainClient } from '../client.js';
import { capToBytes32 } from './registry.js';

// ─── DelegationParams Type ──────────────────────────────

export type DelegationParams = {
  to: Address;
  taskId: Hex;
  budget: bigint;
  targets: Address[];
  methods: string[];
  maxDepth: number;
  currentDepth: number;
  minStake: bigint;
  fee: bigint;
  requiredCaps: string[];
  expiry: number;
  maxCalls?: number;
};

// ─── Standalone Encoder ─────────────────────────────────

/**
 * Encodes AgentTerms into ABI-encoded bytes matching the Solidity struct:
 * tuple(bytes32 taskId, uint8 maxDepth, uint8 currentDepth, uint256 minStake, uint256 fee, bytes32[] requiredCaps)
 *
 * Validates depth values fit in uint8 (0-255).
 */
export function composeAgentTerms(terms: AgentTerms): Hex {
  if (terms.maxDepth < 0 || terms.maxDepth > 255) {
    throw new Error(`maxDepth must be 0-255, got ${terms.maxDepth}`);
  }
  if (terms.currentDepth < 0 || terms.currentDepth > 255) {
    throw new Error(`currentDepth must be 0-255, got ${terms.currentDepth}`);
  }

  return encodeAbiParameters(
    [
      {
        name: 'terms',
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
        taskId: terms.taskId,
        maxDepth: terms.maxDepth,
        currentDepth: terms.currentDepth,
        minStake: terms.minStake,
        fee: terms.fee,
        requiredCaps: terms.requiredCaps,
      },
    ],
  );
}

// ─── DelegationModule ───────────────────────────────────

export class DelegationModule {
  constructor(private readonly client: AgentChainClient) {}

  /**
   * Composes the caveat array for an AgentCapabilityEnforcer delegation.
   * Converts human-readable capability strings to bytes32 hashes and
   * encodes the AgentTerms as the caveat terms.
   */
  composeCaveats(params: DelegationParams): Caveat[] {
    const requiredCapsBytes32 = params.requiredCaps.map(capToBytes32);

    const terms: AgentTerms = {
      taskId: params.taskId,
      maxDepth: params.maxDepth,
      currentDepth: params.currentDepth,
      minStake: params.minStake,
      fee: params.fee,
      requiredCaps: requiredCapsBytes32,
    };

    const encodedTerms = composeAgentTerms(terms);

    return [
      {
        enforcer: this.client.addresses.agentCapabilityEnforcer,
        terms: encodedTerms,
      },
    ];
  }

  /**
   * Encodes AgentTerms into ABI-encoded bytes. Delegates to composeAgentTerms.
   */
  encodeAgentTerms(terms: AgentTerms): Hex {
    return composeAgentTerms(terms);
  }

  /**
   * Creates a signed delegation with AgentCapabilityEnforcer caveats.
   *
   * Builds the delegation struct, computes a hash of the delegation data,
   * and signs it with the wallet client. Throws if no wallet client is available.
   */
  async createDelegation(params: DelegationParams): Promise<SignedDelegation> {
    if (!this.client.walletClient || !this.client.account) {
      throw new Error(
        'Wallet client required to sign delegations. Provide a privateKey in AgentChainConfig.',
      );
    }

    const caveats = this.composeCaveats(params);
    const salt = BigInt(Date.now());

    const delegation: Omit<SignedDelegation, 'signature'> = {
      delegate: params.to,
      delegator: this.client.account.address,
      authority: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex,
      caveats,
      salt,
    };

    // Build a hash of the delegation for signing
    const encodedCaveats = caveats.map((c) =>
      keccak256(
        encodePacked(
          ['address', 'bytes'],
          [c.enforcer, c.terms],
        ),
      ),
    );

    const delegationHash = keccak256(
      encodePacked(
        ['address', 'address', 'bytes32', 'bytes32', 'uint256'],
        [
          delegation.delegate,
          delegation.delegator,
          delegation.authority,
          keccak256(concat(encodedCaveats)),
          salt,
        ],
      ),
    );

    const signature = await this.client.walletClient.signMessage({
      message: { raw: delegationHash },
    });

    return {
      ...delegation,
      signature,
    };
  }
}
