/**
 * Setup script: Deploys and registers all 4 Uniswap agents on AgentChain.
 *
 * For each agent:
 *   1. Derive EOA signer from private key
 *   2. Deploy ERC-4337 smart account via SimpleFactory (CREATE2)
 *   3. Fund smart account with ETH for gas
 *   4. Register ERC-8004 identity
 *   5. Approve USDC + register in AgentChain with capabilities + stake
 *
 * Usage:
 *   PRICE_AGENT_KEY=0x... \
 *   SWAP_AGENT_KEY=0x... \
 *   LP_AGENT_KEY=0x... \
 *   HOOKS_AGENT_KEY=0x... \
 *   BASE_RPC_URL=https://... \
 *   npx tsx agents/uniswap/setup.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  parseEther,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Contract Addresses ──────────────────────────────────

const CONTRACTS = {
  // AgentChain (update after deployment)
  agentRegistry: process.env.AGENT_REGISTRY as Address,
  delegationTracker: process.env.DELEGATION_TRACKER as Address,

  // External
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Address,
  simpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c' as Address,
  delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as Address,
};

// ─── Agent Definitions ───────────────────────────────────

interface AgentDef {
  name: string;
  envKey: string;
  capabilities: string[];
  stakeUsdc: bigint;       // in 6-decimal USDC
  ethFunding: bigint;      // in wei
  endpoint: string;
}

const AGENTS: AgentDef[] = [
  {
    name: 'PriceAgent',
    envKey: 'PRICE_AGENT_KEY',
    capabilities: ['uniswap-price'],
    stakeUsdc: parseUnits('50', 6),
    ethFunding: parseEther('0.01'),
    endpoint: 'https://agentchain.ai/agents/price',
  },
  {
    name: 'SwapAgent',
    envKey: 'SWAP_AGENT_KEY',
    capabilities: ['uniswap-swap', 'uniswap-gasless'],
    stakeUsdc: parseUnits('200', 6),
    ethFunding: parseEther('0.05'),
    endpoint: 'https://agentchain.ai/agents/swap',
  },
  {
    name: 'LPAgent',
    envKey: 'LP_AGENT_KEY',
    capabilities: ['uniswap-lp'],
    stakeUsdc: parseUnits('500', 6),
    ethFunding: parseEther('0.05'),
    endpoint: 'https://agentchain.ai/agents/lp',
  },
  {
    name: 'HooksAgent',
    envKey: 'HOOKS_AGENT_KEY',
    capabilities: ['uniswap-hooks'],
    stakeUsdc: parseUnits('100', 6),
    ethFunding: parseEther('0.01'),
    endpoint: 'https://agentchain.ai/agents/hooks',
  },
];

// ─── ABIs (minimal) ──────────────────────────────────────

const SimpleFactoryAbi = [
  {
    name: 'deploy',
    type: 'function',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ type: 'address' }],
    stateMutability: 'nonpayable',
  },
] as const;

const ERC20Abi = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

const IdentityRegistryAbi = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

const AgentRegistryAbi = [
  {
    name: 'registerAndStake',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'erc8004Id', type: 'uint256' },
      { name: 'capabilities', type: 'bytes32[]' },
      { name: 'endpoint', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ─── Main ────────────────────────────────────────────────

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error('BASE_RPC_URL not set');

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });

  console.log('=== AgentChain Uniswap Agent Deployment ===\n');

  for (const agentDef of AGENTS) {
    const privateKey = process.env[agentDef.envKey] as Hex;
    if (!privateKey) {
      console.log(`⏭  Skipping ${agentDef.name} — ${agentDef.envKey} not set`);
      continue;
    }

    console.log(`\n── ${agentDef.name} ──`);

    const signer = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account: signer,
      chain: base,
      transport: http(rpcUrl),
    });

    // Step 1: Deploy smart account
    console.log('  1. Deploying ERC-4337 smart account...');
    const salt = keccak256(
      encodePacked(['address', 'uint256'], [signer.address, 0n]),
    );
    const initData = encodeAbiParameters(
      parseAbiParameters('address'),
      [signer.address],
    );

    const deployHash = await walletClient.writeContract({
      address: CONTRACTS.simpleFactory,
      abi: SimpleFactoryAbi,
      functionName: 'deploy',
      args: [CONTRACTS.delegationManager, initData, salt],
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const smartAccount = deployReceipt.logs[0]?.address as Address;
    console.log(`     Smart account: ${smartAccount}`);

    // Step 2: Fund with ETH
    console.log(`  2. Funding with ${agentDef.ethFunding} wei ETH...`);
    const fundHash = await walletClient.sendTransaction({
      to: smartAccount,
      value: agentDef.ethFunding,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });

    // Step 3: Register ERC-8004 identity
    console.log('  3. Registering ERC-8004 identity...');
    const identityHash = await walletClient.writeContract({
      address: CONTRACTS.identityRegistry,
      abi: IdentityRegistryAbi,
      functionName: 'register',
      args: [`ipfs://${agentDef.name.toLowerCase()}-metadata`],
    });
    const identityReceipt = await publicClient.waitForTransactionReceipt({ hash: identityHash });
    // Extract erc8004Id from logs (first topic of Transfer event)
    const erc8004Id = BigInt(identityReceipt.logs[0]?.topics[3] || '0');
    console.log(`     ERC-8004 ID: ${erc8004Id}`);

    // Step 4: Approve USDC for staking
    console.log(`  4. Approving ${agentDef.stakeUsdc} USDC for staking...`);
    const approveHash = await walletClient.writeContract({
      address: CONTRACTS.usdc,
      abi: ERC20Abi,
      functionName: 'approve',
      args: [CONTRACTS.agentRegistry, agentDef.stakeUsdc],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Step 5: Register in AgentChain
    console.log('  5. Registering in AgentChain...');
    const capHashes = agentDef.capabilities.map(
      (cap) => keccak256(encodePacked(['string'], [cap])),
    );

    const registerHash = await walletClient.writeContract({
      address: CONTRACTS.agentRegistry,
      abi: AgentRegistryAbi,
      functionName: 'registerAndStake',
      args: [
        agentDef.name,
        erc8004Id,
        capHashes,
        agentDef.endpoint,
        agentDef.stakeUsdc,
      ],
    });
    const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

    console.log(`  ✓ ${agentDef.name} registered!`);
    console.log(`     Address:      ${signer.address}`);
    console.log(`     Smart Account: ${smartAccount}`);
    console.log(`     ERC-8004 ID:  ${erc8004Id}`);
    console.log(`     Capabilities: ${agentDef.capabilities.join(', ')}`);
    console.log(`     Stake:        ${Number(agentDef.stakeUsdc) / 1e6} USDC`);
    console.log(`     Register Tx:  ${registerReceipt.transactionHash}`);
  }

  console.log('\n=== All agents deployed and registered ===');
}

main().catch(console.error);
