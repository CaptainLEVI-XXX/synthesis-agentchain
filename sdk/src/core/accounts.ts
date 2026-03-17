import {
  type Address,
  type Hex,
  encodePacked,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { SimpleFactoryAbi } from '../abis/external/SimpleFactory.js';
import type { AgentChainClient } from '../client.js';

export class AccountsModule {
  constructor(private readonly client: AgentChainClient) {}

  async createAgentAccount(params: {
    signer: PrivateKeyAccount;
    salt?: bigint;
  }): Promise<{ address: Address }> {
    if (!this.client.walletClient) throw new Error('Wallet client required');

    const salt = params.salt ?? 0n;
    const saltBytes = keccak256(
      encodePacked(['address', 'uint256'], [params.signer.address, salt]),
    ) as Hex;

    const initData = encodeAbiParameters(
      parseAbiParameters('address'),
      [params.signer.address],
    );

    const hash = await this.client.walletClient.writeContract({
      address: this.client.addresses.simpleFactory,
      abi: SimpleFactoryAbi,
      functionName: 'deploy',
      args: [this.client.addresses.delegationManager, initData, saltBytes],
    } as any);

    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    const deployedAddress = receipt.logs[0]?.address as Address;
    if (!deployedAddress) {
      throw new Error('Failed to extract deployed account address from transaction logs');
    }

    return { address: deployedAddress };
  }

  async getAccountAddress(signer: Address, salt?: bigint): Promise<Address> {
    const saltValue = salt ?? 0n;
    const saltBytes = keccak256(
      encodePacked(['address', 'uint256'], [signer, saltValue]),
    );
    // Deterministic CREATE2 address — requires init code hash for full computation.
    // For now, returns a hash-based placeholder.
    return `0x${saltBytes.slice(26)}` as Address;
  }
}
