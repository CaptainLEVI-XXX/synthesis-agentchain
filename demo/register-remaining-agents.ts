/**
 * Register PriceAgent + HooksAgent on Base Sepolia
 *
 * Creates new smart accounts via MetaMask SDK, funds them,
 * registers ERC-8004 identity, registers on AgentRegistry.
 *
 * Usage: cd demo && npx tsx register-remaining-agents.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
  keccak256,
  encodePacked,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createBundlerClient } from 'viem/account-abstraction';
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
import { writeFileSync, readFileSync } from 'node:fs';
import { PRIVATE_KEY, RPC_URL, CONTRACTS, EXTERNAL } from './config.js';

const BUNDLER_URL = 'https://public.pimlico.io/v2/84532/rpc';
const STAKE_AMOUNT = 100_000n; // 0.1 USDC

const account = privateKeyToAccount(PRIVATE_KEY);
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(BUNDLER_URL),
});

const ERC20_ABI = [
  { name: 'transfer', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

const IDENTITY_ABI = [
  { name: 'register', type: 'function', inputs: [{ type: 'string' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

const REGISTRY_ABI = [
  {
    name: 'registerAndStake', type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'erc8004Id', type: 'uint256' },
      { name: 'capabilities', type: 'bytes32[]' },
      { name: 'endpoint', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  { name: 'isRegistered', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
] as const;

const AGENTS = [
  {
    name: 'PriceAgent',
    salt: keccak256(toBytes('agentchain-price-v2')),
    capabilities: [keccak256(encodePacked(['string'], ['uniswap-price']))],
    endpoint: 'http://localhost:3001',
    uri: 'ipfs://agentchain/price-agent',
  },
  {
    name: 'HooksAgent',
    salt: keccak256(toBytes('agentchain-hooks-v2')),
    capabilities: [keccak256(encodePacked(['string'], ['uniswap-hooks']))],
    endpoint: 'http://localhost:3004',
    uri: 'ipfs://agentchain/hooks-agent',
  },
];

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Register PriceAgent + HooksAgent (Base Sepolia)');
  console.log('═══════════════════════════════════════════════════════');

  const eoaEth = await publicClient.getBalance({ address: account.address });
  const eoaUsdc = await publicClient.readContract({
    address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`  EOA: ${account.address}`);
  console.log(`  ETH: ${(Number(eoaEth) / 1e18).toFixed(4)}, USDC: ${Number(eoaUsdc) / 1e6}\n`);

  const results: Record<string, { address: string; erc8004Id: number }> = {};

  for (const agent of AGENTS) {
    const sa = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      deployParams: [account.address, [], [], []],
      deploySalt: agent.salt,
      signer: { account },
    });

    console.log(`${agent.name}: ${sa.address}`);

    // Check if already registered
    const isReg = await publicClient.readContract({
      address: CONTRACTS.agentRegistry, abi: REGISTRY_ABI,
      functionName: 'isRegistered', args: [sa.address as Address],
    });
    if (isReg) {
      console.log(`  Already registered — skip\n`);
      continue;
    }

    // Fund with ETH
    const ethBal = await publicClient.getBalance({ address: sa.address });
    if (ethBal < parseEther('0.005')) {
      const h = await walletClient.sendTransaction({ to: sa.address, value: parseEther('0.02') });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log(`  Funded 0.02 ETH`);
    }

    // Fund with USDC
    const usdcBal = await publicClient.readContract({
      address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [sa.address],
    });
    if (usdcBal < 500_000n) {
      const h = await walletClient.writeContract({
        address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'transfer', args: [sa.address, 500_000n],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log(`  Funded 0.5 USDC`);
    }

    // Register ERC-8004 identity
    const idBal = await publicClient.readContract({
      address: EXTERNAL.identityRegistry, abi: IDENTITY_ABI,
      functionName: 'balanceOf', args: [sa.address as Address],
    });

    let identityId: bigint;
    if (idBal > 0n) {
      // Find token ID from Transfer events
      const transferFilter = await publicClient.createEventFilter({
        address: EXTERNAL.identityRegistry,
        event: { type: 'event', name: 'Transfer', inputs: [
          { type: 'address', indexed: true, name: 'from' },
          { type: 'address', indexed: true, name: 'to' },
          { type: 'uint256', indexed: true, name: 'tokenId' },
        ]},
        args: { to: sa.address as Address },
        fromBlock: 39200000n,
      });
      const logs = await publicClient.getFilterLogs({ filter: transferFilter });
      identityId = logs.length > 0 ? logs[logs.length - 1].args.tokenId! : 0n;
      console.log(`  ERC-8004 already exists — identity #${identityId}`);
    } else {
      console.log(`  Registering ERC-8004 identity...`);
      const hash = await bundlerClient.sendUserOperation({
        account: sa,
        calls: [{
          to: EXTERNAL.identityRegistry,
          data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: 'register', args: [agent.uri] }),
        }],
      });
      const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
      console.log(`  ERC-8004 tx: ${receipt.receipt.transactionHash}`);

      // Parse identity ID from Transfer event
      const txReceipt = await publicClient.getTransactionReceipt({ hash: receipt.receipt.transactionHash });
      const transferLog = txReceipt.logs.find(
        l => l.address.toLowerCase() === EXTERNAL.identityRegistry.toLowerCase()
          && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      );
      identityId = transferLog ? BigInt(transferLog.topics[3]!) : 0n;
      console.log(`  Got identity #${identityId}`);
    }

    // Approve USDC + registerAndStake
    console.log(`  Registering on AgentRegistry (${Number(STAKE_AMOUNT) / 1e6} USDC stake)...`);
    const hash2 = await bundlerClient.sendUserOperation({
      account: sa,
      calls: [
        {
          to: EXTERNAL.usdc,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.agentRegistry, STAKE_AMOUNT] }),
        },
        {
          to: CONTRACTS.agentRegistry,
          data: encodeFunctionData({
            abi: REGISTRY_ABI, functionName: 'registerAndStake',
            args: [agent.name, identityId, agent.capabilities, agent.endpoint, STAKE_AMOUNT],
          }),
        },
      ],
    });
    const receipt2 = await bundlerClient.waitForUserOperationReceipt({ hash: hash2 });
    console.log(`  Registry tx: ${receipt2.receipt.transactionHash}`);
    console.log(`  Registered!\n`);

    results[agent.name] = { address: sa.address, erc8004Id: Number(identityId) };
  }

  // Update deployed-addresses.json
  const deployed = JSON.parse(readFileSync('./deployed-addresses.json', 'utf-8'));
  for (const agent of AGENTS) {
    const sa = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      deployParams: [account.address, [], [], []],
      deploySalt: agent.salt,
      signer: { account },
    });
    const key = agent.name === 'PriceAgent' ? 'priceAgent' : 'hooksAgent';
    deployed.smartAccounts[key] = sa.address;
  }
  deployed.timestamp = new Date().toISOString().split('T')[0];
  writeFileSync('./deployed-addresses.json', JSON.stringify(deployed, null, 2) + '\n');

  // Verify
  console.log('═══════════════════════════════════════════════════════');
  console.log('  DONE — All 4 agents registered');
  console.log('═══════════════════════════════════════════════════════');
  for (const agent of AGENTS) {
    const sa = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      deployParams: [account.address, [], [], []],
      deploySalt: agent.salt,
      signer: { account },
    });
    const isReg = await publicClient.readContract({
      address: CONTRACTS.agentRegistry, abi: REGISTRY_ABI,
      functionName: 'isRegistered', args: [sa.address as Address],
    });
    console.log(`  ${agent.name} (${sa.address}): registered=${isReg}`);
  }
  console.log('\n  deployed-addresses.json updated.');
}

main().catch(console.error);
