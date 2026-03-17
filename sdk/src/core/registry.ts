import {
  type Address,
  type Hex,
  type TransactionReceipt,
  keccak256,
  encodePacked,
} from 'viem';
import { AgentRegistryAbi } from '../abis/AgentRegistry.js';
import type { AgentInfo } from '../types/index.js';
import type { AgentChainClient } from '../client.js';

export function capToBytes32(cap: string): Hex {
  return keccak256(encodePacked(['string'], [cap]));
}

export class RegistryModule {
  constructor(private readonly client: AgentChainClient) {}

  private get addr() {
    return this.client.addresses.agentRegistry;
  }

  private async write(fn: string, args: any[]): Promise<TransactionReceipt> {
    if (!this.client.walletClient) throw new Error('Wallet client required for write operations');
    const hash = await this.client.walletClient.writeContract({
      address: this.addr,
      abi: AgentRegistryAbi,
      functionName: fn,
      args,
    } as any);
    return this.client.publicClient.waitForTransactionReceipt({ hash });
  }

  private async read(fn: string, args?: any[]): Promise<any> {
    return this.client.publicClient.readContract({
      address: this.addr,
      abi: AgentRegistryAbi,
      functionName: fn,
      args,
    } as any);
  }

  async registerAndStake(params: {
    name: string;
    erc8004Id: bigint;
    capabilities: string[];
    endpoint: string;
    stakeAmount: bigint;
  }) {
    const caps = params.capabilities.map(capToBytes32);
    return this.write('registerAndStake', [params.name, params.erc8004Id, caps, params.endpoint, params.stakeAmount]);
  }

  async register(params: {
    name: string;
    erc8004Id: bigint;
    capabilities: string[];
    endpoint: string;
  }) {
    const caps = params.capabilities.map(capToBytes32);
    return this.write('register', [params.name, params.erc8004Id, caps, params.endpoint]);
  }

  async addStake(amount: bigint) { return this.write('addStake', [amount]); }
  async unstake(amount: bigint) { return this.write('unstake', [amount]); }

  async updateCapabilities(capabilities: string[]) {
    return this.write('updateCapabilities', [capabilities.map(capToBytes32)]);
  }

  async updateEndpoint(endpoint: string) { return this.write('updateEndpoint', [endpoint]); }
  async linkENSName(ensName: string) { return this.write('linkENSName', [ensName]); }
  async deactivate() { return this.write('deactivate', []); }

  async getAgent(address: Address): Promise<AgentInfo> {
    const [agentData, stake] = await Promise.all([
      this.read('getAgent', [address]),
      this.read('stakes', [address]),
    ]);
    return {
      address,
      name: agentData.name,
      endpoint: agentData.endpoint,
      erc8004Id: agentData.erc8004Id,
      ensName: agentData.ensName,
      registeredAt: agentData.registeredAt,
      active: agentData.active,
      stake,
      capabilityHashes: [...agentData.capabilities] as Hex[],
    };
  }

  async getAgentsByCapability(capability: string): Promise<Address[]> {
    return this.read('getAgentsByCapability', [capToBytes32(capability)]);
  }

  async stakes(address: Address): Promise<bigint> { return this.read('stakes', [address]); }
  async isRegistered(address: Address): Promise<boolean> { return this.read('isRegistered', [address]); }

  async hasCapabilities(address: Address, capabilities: string[]): Promise<boolean> {
    return this.read('hasCapabilities', [address, capabilities.map(capToBytes32)]);
  }
}
