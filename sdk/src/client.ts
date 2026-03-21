import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
  type Transport,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { AgentChainConfig, ContractAddresses } from './types/index.js';

export const BASE_ADDRESSES: ContractAddresses = {
  agentRegistry: '0x0000000000000000000000000000000000000000',
  delegationTracker: '0x0000000000000000000000000000000000000000',
  agentChainArbiter: '0x0000000000000000000000000000000000000000',
  agentCapabilityEnforcer: '0x0000000000000000000000000000000000000000',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
  simpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c',
  alkahestEscrow: '0x0000000000000000000000000000000000000000',
  eas: '0x4200000000000000000000000000000000000021',
};

export const BASE_SEPOLIA_ADDRESSES: ContractAddresses = {
  ...BASE_ADDRESSES,
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  alkahestEscrow: '0x1Fe964348Ec42D9Bb1A072503ce8b4744266FF43',
  eas: '0x4200000000000000000000000000000000000021',
};

export type AgentChainClient = {
  publicClient: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, Account>;
  account?: Account;
  addresses: ContractAddresses;
  chain: Chain;
};

const CHAINS: Record<string, Chain> = {
  base,
  baseSepolia,
};

const DEFAULT_ADDRESSES: Record<string, ContractAddresses> = {
  base: BASE_ADDRESSES,
  baseSepolia: BASE_SEPOLIA_ADDRESSES,
};

export function createAgentChainClient(config: AgentChainConfig): AgentChainClient {
  const chain = CHAINS[config.chain];
  if (!chain) throw new Error(`Unsupported chain: ${config.chain}`);

  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  const defaults = DEFAULT_ADDRESSES[config.chain];
  const addresses: ContractAddresses = { ...defaults, ...config.contracts };

  let walletClient: WalletClient<Transport, Chain, Account> | undefined;
  let account: Account | undefined;

  if (config.privateKey) {
    account = privateKeyToAccount(config.privateKey);
    walletClient = createWalletClient({ chain, transport, account });
  }

  return { publicClient, walletClient, account, addresses, chain };
}
