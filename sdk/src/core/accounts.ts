import {
  type Address,
  type Hex,
  keccak256,
  toBytes,
} from 'viem';
import type { AgentChainClient } from '../client.js';

export class AccountsModule {
  constructor(private readonly client: AgentChainClient) {}

  /** Get the smart account address (deterministic from salt).
   *  Returns the address without deploying — the account gets deployed
   *  on the first UserOperation automatically. */
  getSmartAccountAddress(): Address {
    if (!this.client.smartAccount) {
      throw new Error('Smart account not configured. Provide smartAccountSalt in config.');
    }
    return this.client.smartAccount.address;
  }

  /** Check if the smart account is already deployed on-chain. */
  async isDeployed(): Promise<boolean> {
    if (!this.client.smartAccount) return false;
    return this.client.smartAccount.isDeployed();
  }

  /** Generate a deterministic salt from a human-readable name.
   *  Use this to create predictable smart account addresses:
   *  const salt = AccountsModule.saltFromName("my-agent");
   *  const client = await createAgentChainClient({ ..., smartAccountSalt: salt }); */
  static saltFromName(name: string): Hex {
    return keccak256(toBytes(name));
  }
}
