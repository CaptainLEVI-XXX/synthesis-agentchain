import type { Address } from 'viem';
import type { AgentChainClient } from '../client.js';
import type { AgentInfo } from '../types/index.js';
import type { RegistryModule } from './registry.js';
import type { ReputationModule } from './reputation.js';
import type { OlasBridgeModule } from './olas-bridge.js';

export class DiscoveryModule {
  private client: AgentChainClient;
  private registry: RegistryModule;
  private reputation: ReputationModule;
  private olas: OlasBridgeModule;

  constructor(
    client: AgentChainClient,
    registry: RegistryModule,
    reputation: ReputationModule,
    olas: OlasBridgeModule,
  ) {
    this.client = client;
    this.registry = registry;
    this.reputation = reputation;
    this.olas = olas;
  }

  async discover(params: {
    capability: string;
    minReputation?: number;
    minStake?: bigint;
    sources?: ('agentchain' | 'olas')[];
  }): Promise<AgentInfo[]> {
    const sources = params.sources ?? ['agentchain'];
    const results: AgentInfo[] = [];

    if (sources.includes('agentchain')) {
      const addresses = await this.registry.getAgentsByCapability(params.capability);

      for (const addr of addresses) {
        const agent = await this.registry.getAgent(addr);

        if (params.minStake && agent.stake < params.minStake) continue;

        if (params.minReputation && agent.erc8004Id > 0n) {
          const rep = await this.reputation.getSummary(agent.erc8004Id);
          if (rep.count > 0n) {
            const ratingDecimal = Number(rep.avgRating) / Math.pow(10, rep.decimals);
            if (ratingDecimal < params.minReputation) continue;
          }
        }

        results.push(agent);
      }
    }

    if (sources.includes('olas') && results.length === 0) {
      try {
        const mechs = await this.olas.discoverMechs(params.capability);
        for (const mech of mechs) {
          results.push({
            address: '0x0000000000000000000000000000000000000000' as Address,
            name: `Olas Mech: ${mech.id}`,
            endpoint: '',
            erc8004Id: 0n,
            ensName: '',
            registeredAt: 0n,
            active: true,
            stake: mech.price,
            capabilityHashes: [],
          });
        }
      } catch {
        // Olas unavailable — silently skip
      }
    }

    return results;
  }
}
