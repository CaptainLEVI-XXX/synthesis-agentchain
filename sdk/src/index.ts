import { createAgentChainClient, type AgentChainClient } from './client.js';
import { RegistryModule } from './core/registry.js';
import { TrackerModule } from './core/tracker.js';
import { ArbiterModule } from './core/arbiter.js';
import { DelegationModule } from './core/delegation.js';
import { AccountsModule } from './core/accounts.js';
import { EscrowModule } from './core/escrow.js';
import { ReputationModule } from './core/reputation.js';
import { DiscoveryModule } from './core/discovery.js';
import { OlasBridgeModule } from './core/olas-bridge.js';
import { RelayModule } from './relay/proposals.js';
import { EventsModule } from './events/listener.js';
import type { AgentChainConfig } from './types/index.js';

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

  private constructor(client: AgentChainClient, relayUrl?: string) {
    this.registry = new RegistryModule(client);
    this.tracker = new TrackerModule(client);
    this.arbiter = new ArbiterModule(client);
    this.delegation = new DelegationModule(client);
    this.accounts = new AccountsModule(client);
    this.escrow = new EscrowModule(client);
    this.reputation = new ReputationModule(client);
    this.olas = new OlasBridgeModule();
    this.relay = new RelayModule(client, relayUrl ?? 'https://relay.agentchain.ai');
    this.events = new EventsModule(client);
    this.discovery = new DiscoveryModule(
      client,
      this.registry,
      this.reputation,
      this.olas,
    );
  }

  static create(config: AgentChainConfig & { relayUrl?: string }): AgentChain {
    const client = createAgentChainClient(config);
    return new AgentChain(client, config.relayUrl);
  }
}

// Re-export modules
export { createAgentChainClient, BASE_ADDRESSES, BASE_SEPOLIA_ADDRESSES } from './client.js';
export { capToBytes32, RegistryModule } from './core/registry.js';
export { TrackerModule } from './core/tracker.js';
export { ArbiterModule } from './core/arbiter.js';
export { DelegationModule, composeAgentTerms } from './core/delegation.js';
export { AccountsModule } from './core/accounts.js';
export { EscrowModule } from './core/escrow.js';
export { ReputationModule } from './core/reputation.js';
export { DiscoveryModule } from './core/discovery.js';
export { OlasBridgeModule } from './core/olas-bridge.js';
export { RelayModule } from './relay/proposals.js';
export { EventsModule } from './events/listener.js';
export { matchesCapability, matchesAllCapabilities } from './events/filters.js';
export * from './types/index.js';
