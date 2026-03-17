import { describe, it, expect } from 'vitest';
import { createAgentChainClient, BASE_ADDRESSES, BASE_SEPOLIA_ADDRESSES } from '../src/client.js';

describe('createAgentChainClient', () => {
  it('resolves Base mainnet addresses by default', () => {
    const client = createAgentChainClient({
      chain: 'base',
      rpcUrl: 'https://mainnet.base.org',
    });
    expect(client.addresses.usdc).toBe(BASE_ADDRESSES.usdc);
    expect(client.addresses.identityRegistry).toBe(BASE_ADDRESSES.identityRegistry);
    expect(client.publicClient).toBeDefined();
  });

  it('resolves Base Sepolia addresses', () => {
    const client = createAgentChainClient({
      chain: 'baseSepolia',
      rpcUrl: 'https://sepolia.base.org',
    });
    expect(client.addresses.usdc).toBe(BASE_SEPOLIA_ADDRESSES.usdc);
  });

  it('allows contract address overrides', () => {
    const custom = '0x1111111111111111111111111111111111111111' as const;
    const client = createAgentChainClient({
      chain: 'base',
      rpcUrl: 'https://mainnet.base.org',
      contracts: { agentRegistry: custom },
    });
    expect(client.addresses.agentRegistry).toBe(custom);
  });

  it('creates wallet client when privateKey provided', () => {
    const client = createAgentChainClient({
      chain: 'base',
      rpcUrl: 'https://mainnet.base.org',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });
    expect(client.walletClient).toBeDefined();
    expect(client.account).toBeDefined();
  });

  it('throws on unsupported chain', () => {
    expect(() =>
      createAgentChainClient({ chain: 'ethereum' as any }),
    ).toThrow('Unsupported chain');
  });
});
