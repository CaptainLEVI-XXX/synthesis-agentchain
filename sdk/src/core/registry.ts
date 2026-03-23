import {
  type Address,
  type Hex,
  keccak256,
  encodePacked,
} from 'viem';
import { AgentRegistryAbi } from '../abis/AgentRegistry.js';
import type { AgentInfo } from '../types/index.js';
import type { AgentChainClient } from '../client.js';
import { sendWrite, sendBatchWrite } from '../client.js';

const ERC20_APPROVE_ABI = [
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const;

export function capToBytes32(cap: string): Hex {
  return keccak256(encodePacked(['string'], [cap]));
}

export class RegistryModule {
  constructor(private readonly client: AgentChainClient) {}

  private get addr() {
    return this.client.addresses.agentRegistry;
  }

  private async read(fn: string, args?: any[]): Promise<any> {
    return this.client.publicClient.readContract({
      address: this.addr,
      abi: AgentRegistryAbi,
      functionName: fn,
      args,
    } as any);
  }

  /** Register agent and stake USDC in a single UserOp (batched: approve + registerAndStake).
   *  The smart account must have USDC balance for the stake. */
  async registerAndStake(params: {
    name: string;
    erc8004Id: bigint;
    capabilities: string[];
    endpoint: string;
    stakeAmount: bigint;
  }): Promise<Hex> {
    const caps = params.capabilities.map(capToBytes32);

    // Batch: approve USDC + registerAndStake in one UserOp
    return sendBatchWrite(this.client, [
      {
        to: this.client.addresses.usdc,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [this.addr, params.stakeAmount],
      },
      {
        to: this.addr,
        abi: AgentRegistryAbi,
        functionName: 'registerAndStake',
        args: [params.name, params.erc8004Id, caps, params.endpoint, params.stakeAmount],
      },
    ]);
  }

  async addStake(amount: bigint): Promise<Hex> {
    return sendBatchWrite(this.client, [
      { to: this.client.addresses.usdc, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [this.addr, amount] },
      { to: this.addr, abi: AgentRegistryAbi, functionName: 'addStake', args: [amount] },
    ]);
  }

  async unstake(amount: bigint): Promise<Hex> {
    return sendWrite(this.client, this.addr, AgentRegistryAbi, 'unstake', [amount]);
  }

  async updateCapabilities(capabilities: string[]): Promise<Hex> {
    return sendWrite(this.client, this.addr, AgentRegistryAbi, 'updateCapabilities', [capabilities.map(capToBytes32)]);
  }

  async updateEndpoint(endpoint: string): Promise<Hex> {
    return sendWrite(this.client, this.addr, AgentRegistryAbi, 'updateEndpoint', [endpoint]);
  }

  async linkENSName(ensName: string): Promise<Hex> {
    return sendWrite(this.client, this.addr, AgentRegistryAbi, 'linkENSName', [ensName]);
  }

  async deactivate(): Promise<Hex> {
    return sendWrite(this.client, this.addr, AgentRegistryAbi, 'deactivate', []);
  }

  // ─── Read Operations (unchanged — no UserOps needed) ──

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
