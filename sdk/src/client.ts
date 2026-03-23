import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
  type Transport,
  type Address,
  type Hex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createBundlerClient, type BundlerClient } from 'viem/account-abstraction';
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
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
  agentRegistry: '0xa5bF9723b9E286bBa502617A8A6D2f24cBdEbf62',
  delegationTracker: '0xe0585a939E2C128d1Ff8F4C681529A2AB8f9917d',
  agentChainArbiter: '0xf9276b374eF30806b62119027a1e4251A4AD8Cf5',
  agentCapabilityEnforcer: '0xB06D7126abe20eb8B8850db354bd59EFD6a8a2Ff',
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
  simpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c',
  alkahestEscrow: '0x1Fe964348Ec42D9Bb1A072503ce8b4744266FF43',
  eas: '0x4200000000000000000000000000000000000021',
};

/**
 * AgentChainClient — the core client object used by all SDK modules.
 *
 * Supports two modes:
 *   1. Smart Account mode (smartAccount set): all writes go through UserOps via bundler
 *   2. EOA mode (no smartAccount): writes go directly via walletClient (legacy)
 */
export type AgentChainClient = {
  publicClient: PublicClient<Transport, Chain>;
  walletClient?: WalletClient<Transport, Chain, Account>;
  bundlerClient?: BundlerClient;
  smartAccount?: any;  // MetaMask SmartAccount from toMetaMaskSmartAccount
  account?: Account;
  addresses: ContractAddresses;
  chain: Chain;
};

const CHAINS: Record<string, Chain> = { base, baseSepolia };
const CHAIN_IDS: Record<string, number> = { base: 8453, baseSepolia: 84532 };
const DEFAULT_ADDRESSES: Record<string, ContractAddresses> = {
  base: BASE_ADDRESSES,
  baseSepolia: BASE_SEPOLIA_ADDRESSES,
};

/**
 * Create an AgentChain client.
 *
 * If `smartAccountSalt` is provided, creates a MetaMask HybridDeleGator smart account
 * and a bundler client. All write operations will go through UserOperations.
 *
 * If no salt, operates in EOA mode (direct walletClient writes).
 */
export async function createAgentChainClient(config: AgentChainConfig): Promise<AgentChainClient> {
  const chain = CHAINS[config.chain];
  if (!chain) throw new Error(`Unsupported chain: ${config.chain}`);

  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  const defaults = DEFAULT_ADDRESSES[config.chain];
  const addresses: ContractAddresses = { ...defaults, ...config.contracts };

  let walletClient: WalletClient<Transport, Chain, Account> | undefined;
  let account: Account | undefined;
  let bundlerClient: BundlerClient | undefined;
  let smartAccount: any;

  if (config.privateKey) {
    account = privateKeyToAccount(config.privateKey);
    walletClient = createWalletClient({ chain, transport, account });

    // Smart account mode
    if (config.smartAccountSalt) {
      const chainId = CHAIN_IDS[config.chain];
      const bundlerUrl = config.bundlerUrl ?? `https://public.pimlico.io/v2/${chainId}/rpc`;

      bundlerClient = createBundlerClient({
        client: publicClient,
        transport: http(bundlerUrl),
      });

      smartAccount = await toMetaMaskSmartAccount({
        client: publicClient,
        implementation: Implementation.Hybrid,
        deployParams: [account.address, [], [], []],
        deploySalt: config.smartAccountSalt,
        signer: { account },
      });
    }
  }

  return { publicClient, walletClient, bundlerClient, smartAccount, account, addresses, chain };
}

/**
 * Send a write operation through the smart account (UserOp) or EOA (direct).
 * Used by all SDK modules for write operations.
 */
export async function sendWrite(
  client: AgentChainClient,
  to: Address,
  abi: any,
  functionName: string,
  args: any[],
): Promise<Hex> {
  // Smart account mode — send via bundler as UserOperation
  if (client.smartAccount && client.bundlerClient) {
    const data = encodeFunctionData({ abi, functionName, args });
    const hash = await client.bundlerClient.sendUserOperation({
      account: client.smartAccount,
      calls: [{ to, data }],
    });
    const receipt = await client.bundlerClient.waitForUserOperationReceipt({ hash });
    if (!receipt.success) {
      throw new Error(`UserOp failed: ${receipt.reason || 'unknown'}`);
    }
    return receipt.receipt.transactionHash;
  }

  // EOA mode — direct write
  if (!client.walletClient) throw new Error('Wallet client required for write operations');
  const txHash = await client.walletClient.writeContract({
    address: to,
    abi,
    functionName,
    args,
  } as any);
  await client.publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Send multiple write operations in a single UserOp (batched).
 * Falls back to sequential EOA writes if no smart account.
 */
export async function sendBatchWrite(
  client: AgentChainClient,
  calls: { to: Address; abi: any; functionName: string; args: any[] }[],
): Promise<Hex> {
  if (client.smartAccount && client.bundlerClient) {
    const encodedCalls = calls.map(c => ({
      to: c.to,
      data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args }),
    }));
    const hash = await client.bundlerClient.sendUserOperation({
      account: client.smartAccount,
      calls: encodedCalls,
    });
    const receipt = await client.bundlerClient.waitForUserOperationReceipt({ hash });
    if (!receipt.success) {
      throw new Error(`UserOp failed: ${receipt.reason || 'unknown'}`);
    }
    return receipt.receipt.transactionHash;
  }

  // EOA mode — sequential writes
  let lastTxHash: Hex = '0x' as Hex;
  for (const call of calls) {
    lastTxHash = await sendWrite(client, call.to, call.abi, call.functionName, call.args);
  }
  return lastTxHash;
}
