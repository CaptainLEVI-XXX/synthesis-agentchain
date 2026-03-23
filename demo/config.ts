import type { Address, Hex } from 'viem';
import { readFileSync } from 'node:fs';

// Load deployed addresses
const deployed = JSON.parse(readFileSync(new URL('./deployed-addresses.json', import.meta.url), 'utf-8'));

// ─── Network ─────────────────────────────────────────────
export const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia.infura.io/v3/44bdf2d1c8594cc9b16832398af754d7';
export const CHAIN_ID = deployed.chainId;

// ─── Deployer / User Key ─────────────────────────────────
export const PRIVATE_KEY = (process.env.DEPLOYER_KEY || (() => { throw new Error('DEPLOYER_KEY env variable required'); })()) as Hex;

// ─── EOA + Smart Accounts ────────────────────────────────
export const EOA = deployed.eoa as Address;
export const SMART_ACCOUNTS = {
  user: deployed.smartAccounts.user as Address,
  lpAgent: deployed.smartAccounts.lpAgent as Address,
  swapAgent: deployed.smartAccounts.swapAgent as Address,
  priceAgent: deployed.smartAccounts.priceAgent as Address,
  hooksAgent: deployed.smartAccounts.hooksAgent as Address,
};

// ─── AgentChain Contracts (Base Sepolia) ─────────────────
export const CONTRACTS = {
  agentRegistry: deployed.contracts.agentRegistry as Address,
  delegationTracker: deployed.contracts.delegationTracker as Address,
  agentCapabilityEnforcer: deployed.contracts.agentCapabilityEnforcer as Address,
  agentChainArbiter: deployed.contracts.agentChainArbiter as Address,
};

// ─── External Contracts (Base Sepolia) ───────────────────
export const EXTERNAL = {
  usdc: deployed.external.usdc as Address,
  identityRegistry: deployed.external.identityRegistry as Address,
  reputationRegistry: deployed.external.reputationRegistry as Address,
  delegationManager: deployed.external.delegationManager as Address,
  simpleFactory: deployed.external.simpleFactory as Address,
  hybridDeleGatorImpl: deployed.external.hybridDeleGatorImpl as Address,
  alkahestEscrow: deployed.external.alkahestEscrow as Address,
  eas: deployed.external.eas as Address,
};

// ─── Agent Config ────────────────────────────────────────
export const AGENTS = [
  {
    name: 'PriceAgent',
    smartAccount: SMART_ACCOUNTS.priceAgent,
    capabilities: ['uniswap-price'],
    stake: 100000n,  // 0.1 USDC
    endpoint: 'http://localhost:3001',
    port: 3001,
  },
  {
    name: 'SwapAgent',
    smartAccount: SMART_ACCOUNTS.swapAgent,
    capabilities: ['uniswap-swap', 'uniswap-gasless'],
    stake: 100000n,
    endpoint: 'http://localhost:3002',
    port: 3002,
  },
  {
    name: 'LPAgent',
    smartAccount: SMART_ACCOUNTS.lpAgent,
    capabilities: ['uniswap-lp'],
    stake: 100000n,
    endpoint: 'http://localhost:3003',
    port: 3003,
  },
  {
    name: 'HooksAgent',
    smartAccount: SMART_ACCOUNTS.hooksAgent,
    capabilities: ['uniswap-hooks'],
    stake: 100000n,
    endpoint: 'http://localhost:3004',
    port: 3004,
  },
];

// ─── Demo Parameters ─────────────────────────────────────
export const DEMO = {
  feePool: 1000000n,  // 1 USDC
  deposit: 5000000n,  // 5 USDC (reference amount)
  taskDeadlineSeconds: 86400, // 24 hours
};
