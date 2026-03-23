/**
 * AgentChain Demo — Fund & Register Agents on Base Sepolia
 *
 * Creates smart accounts via @metamask/smart-accounts-kit (SimpleFactory),
 * funds them, registers ERC-8004 identities, and registers on AgentRegistry.
 *
 * Usage:  cd demo && npx tsx fund-and-register.ts
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
import { PRIVATE_KEY, RPC_URL, CONTRACTS, EXTERNAL } from './config.js';
import { writeFileSync } from 'node:fs';

// ─── Setup ──────────────────────────────────────────────
const BUNDLER_URL = 'https://public.pimlico.io/v2/84532/rpc';
const STAKE_AMOUNT = 100_000n; // 0.1 USDC (low fees as requested)

const account = privateKeyToAccount(PRIVATE_KEY);
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport });
const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(BUNDLER_URL),
});

// ─── ABIs ───────────────────────────────────────────────
const ERC20_ABI = [
  { name: 'transfer', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

const IDENTITY_ABI = [
  { name: 'register', type: 'function', inputs: [{ type: 'string' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'tokenOfOwnerByIndex', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
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

// ─── Agent Definitions ──────────────────────────────────
const AGENTS_CONFIG = [
  {
    name: 'LPAgent',
    salt: keccak256(toBytes('agentchain-lp-v2')),
    capabilities: [keccak256(encodePacked(['string'], ['uniswap-lp']))],
    endpoint: 'http://localhost:3003',
    uri: 'ipfs://agentchain/lp-agent',
  },
  {
    name: 'SwapAgent',
    salt: keccak256(toBytes('agentchain-swap-v2')),
    capabilities: [
      keccak256(encodePacked(['string'], ['uniswap-swap'])),
      keccak256(encodePacked(['string'], ['uniswap-gasless'])),
    ],
    endpoint: 'http://localhost:3002',
    uri: 'ipfs://agentchain/swap-agent',
  },
];

// ─── Helper ─────────────────────────────────────────────
async function createSmartAccount(salt: Hex) {
  return toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [account.address, [], [], []],
    deploySalt: salt,
    signer: { account },
  });
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AgentChain — Fund & Register Agents (Base Sepolia)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  EOA: ${account.address}`);

  const eoaEth = await publicClient.getBalance({ address: account.address });
  const eoaUsdc = await publicClient.readContract({
    address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`  ETH: ${(Number(eoaEth) / 1e18).toFixed(4)}, USDC: ${Number(eoaUsdc) / 1e6}`);
  console.log('');

  // ─── Create smart accounts via SDK ────────────────────
  const userSA = await createSmartAccount(keccak256(toBytes('agentchain-user-v2')));
  const agentSAs: { name: string; sa: any; config: typeof AGENTS_CONFIG[0] }[] = [];

  for (const cfg of AGENTS_CONFIG) {
    const sa = await createSmartAccount(cfg.salt);
    agentSAs.push({ name: cfg.name, sa, config: cfg });
  }

  console.log('Smart Accounts (via MetaMask SDK + SimpleFactory):');
  console.log(`  User:      ${userSA.address}`);
  for (const { name, sa } of agentSAs) {
    console.log(`  ${name.padEnd(10)} ${sa.address}`);
  }
  console.log('');

  // ─── Step 1: Fund with ETH ────────────────────────────
  console.log('Step 1: Funding with ETH...');
  for (const { name, sa } of [{ name: 'User', sa: userSA }, ...agentSAs]) {
    const bal = await publicClient.getBalance({ address: sa.address });
    if (bal < parseEther('0.005')) {
      const hash = await walletClient.sendTransaction({ to: sa.address, value: parseEther('0.02') });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${name}: +0.02 ETH (${hash.slice(0, 18)}...)`);
    } else {
      console.log(`  ${name}: ${(Number(bal) / 1e18).toFixed(4)} ETH — ok`);
    }
  }

  // ─── Step 2: Fund with USDC ───────────────────────────
  console.log('\nStep 2: Funding with USDC...');
  for (const { name, sa } of [{ name: 'User', sa: userSA }, ...agentSAs]) {
    const needed = name === 'User' ? 5_000_000n : 500_000n; // 5 USDC user, 0.5 USDC agents
    const bal = await publicClient.readContract({
      address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [sa.address],
    });
    if (bal < needed) {
      const hash = await walletClient.writeContract({
        address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'transfer', args: [sa.address, needed],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ${name}: +${Number(needed) / 1e6} USDC (${hash.slice(0, 18)}...)`);
    } else {
      console.log(`  ${name}: ${Number(bal) / 1e6} USDC — ok`);
    }
  }

  // ─── Step 3: Register agents (deploy SA + ERC-8004 + AgentRegistry) ───
  console.log('\nStep 3: Registering agents via UserOperations...');
  console.log('  (First UserOp deploys the smart account via SimpleFactory)');

  for (const { name, sa, config } of agentSAs) {
    const isReg = await publicClient.readContract({
      address: CONTRACTS.agentRegistry, abi: REGISTRY_ABI,
      functionName: 'isRegistered', args: [sa.address as Address],
    });
    if (isReg) {
      console.log(`  ${name}: already registered — skip`);
      continue;
    }

    // Check ERC-8004
    let identityId: bigint;
    const idBal = await publicClient.readContract({
      address: EXTERNAL.identityRegistry, abi: IDENTITY_ABI,
      functionName: 'balanceOf', args: [sa.address as Address],
    });

    if (idBal > 0n) {
      // Can't use tokenOfOwnerByIndex (not supported). Use a known ID or skip.
      // For the demo, we'll just use ID 0 and let registerAndStake handle it.
      // Actually, we need the real ID. Let's query recent Transfer events.
      const transferFilter = await publicClient.createEventFilter({
        address: EXTERNAL.identityRegistry,
        event: { type: 'event', name: 'Transfer', inputs: [
          { type: 'address', indexed: true, name: 'from' },
          { type: 'address', indexed: true, name: 'to' },
          { type: 'uint256', indexed: true, name: 'tokenId' },
        ]},
        args: { to: sa.address as Address },
        fromBlock: 'earliest',
      });
      const logs = await publicClient.getFilterLogs({ filter: transferFilter });
      identityId = logs.length > 0 ? logs[logs.length - 1].args.tokenId! : 0n;
      console.log(`  ${name}: has ERC-8004 #${identityId}`);
    } else {
      console.log(`  ${name}: registering ERC-8004 identity...`);
      const hash = await bundlerClient.sendUserOperation({
        account: sa,
        calls: [{
          to: EXTERNAL.identityRegistry,
          data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: 'register', args: [config.uri] }),
        }],
      });
      console.log(`    UserOp: ${hash}`);
      const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
      console.log(`    Tx: ${receipt.receipt.transactionHash}`);

      // Parse token ID from Transfer event in the tx receipt
      const txReceipt = await publicClient.getTransactionReceipt({ hash: receipt.receipt.transactionHash });
      const transferLog = txReceipt.logs.find(
        l => l.address.toLowerCase() === EXTERNAL.identityRegistry.toLowerCase()
          && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer
      );
      identityId = transferLog ? BigInt(transferLog.topics[3]!) : 0n;
      console.log(`    Got identity #${identityId}`);
    }

    // Approve USDC + registerAndStake in one UserOp
    console.log(`  ${name}: approve + registerAndStake (${Number(STAKE_AMOUNT) / 1e6} USDC)...`);
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
            args: [name, identityId, config.capabilities, config.endpoint, STAKE_AMOUNT],
          }),
        },
      ],
    });
    console.log(`    UserOp: ${hash2}`);
    const receipt2 = await bundlerClient.waitForUserOperationReceipt({ hash: hash2 });
    console.log(`    Tx: ${receipt2.receipt.transactionHash}`);
    console.log(`    Registered with ${Number(STAKE_AMOUNT) / 1e6} USDC stake`);
  }

  // ─── Step 4: User approves USDC to tracker ────────────
  console.log('\nStep 4: User SA approves USDC to DelegationTracker...');
  const hash4 = await bundlerClient.sendUserOperation({
    account: userSA,
    calls: [{
      to: EXTERNAL.usdc,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.delegationTracker, 100_000_000n] }),
    }],
  });
  const receipt4 = await bundlerClient.waitForUserOperationReceipt({ hash: hash4 });
  console.log(`  Tx: ${receipt4.receipt.transactionHash}`);

  // ─── Save new addresses ───────────────────────────────
  const newAddresses = {
    user: userSA.address,
    lpAgent: agentSAs[0].sa.address,
    swapAgent: agentSAs[1].sa.address,
  };

  // Update deployed-addresses.json with new SA addresses
  const { readFileSync } = await import('node:fs');
  const deployed = JSON.parse(readFileSync('./deployed-addresses.json', 'utf-8'));
  deployed.smartAccounts = {
    ...deployed.smartAccounts,
    user: newAddresses.user,
    lpAgent: newAddresses.lpAgent,
    swapAgent: newAddresses.swapAgent,
  };
  deployed.timestamp = new Date().toISOString().split('T')[0];
  writeFileSync('./deployed-addresses.json', JSON.stringify(deployed, null, 2) + '\n');

  // ─── Summary ──────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SETUP COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  for (const { name, sa } of agentSAs) {
    const isReg = await publicClient.readContract({
      address: CONTRACTS.agentRegistry, abi: REGISTRY_ABI,
      functionName: 'isRegistered', args: [sa.address as Address],
    });
    console.log(`  ${name} (${sa.address}): registered=${isReg}`);
  }
  console.log(`  User: ${userSA.address}`);
  console.log('');
  console.log('  deployed-addresses.json updated with new SA addresses.');
  console.log('');
  console.log('  Next steps:');
  console.log('    Terminal 1: cd agents/uniswap && npx tsx swap-agent/server.ts');
  console.log('    Terminal 2: cd agents/uniswap && npx tsx lp-agent/server.ts');
  console.log('    Terminal 3: cd demo && npx tsx submit-intent.ts "Invest 0.01 ETH in LP"');
}

main().catch(console.error);
