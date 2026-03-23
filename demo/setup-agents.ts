/**
 * AgentChain Setup — Deploy Smart Accounts + Register Agents
 *
 * Deploys ERC-4337 smart accounts (HybridDeleGator) for:
 *   - User (salt=0) — the delegator in Flow A
 *   - LPAgent / Orchestrator (salt=1)
 *   - SwapAgent (salt=2)
 *   - PriceAgent (salt=3)
 *   - HooksAgent (salt=4)
 *
 * All controlled by the same EOA signer via different CREATE2 salts.
 * Each smart account gets a unique on-chain address.
 *
 * Then registers the orchestrator in AgentChain (ERC-8004 + AgentRegistry).
 * Note: registerAndStake is called from the EOA (not smart account) because
 * calling from the smart account requires a bundler. The registration address
 * is the EOA. For production, agents would use a bundler to register from
 * their smart account address.
 *
 * Usage:
 *   cd demo && npm install && npx tsx setup-agents.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { PRIVATE_KEY, RPC_URL, CONTRACTS, EXTERNAL, AGENTS } from './config.js';

// ─── ABIs ────────────────────────────────────────────────

const SimpleFactoryAbi = [
  {
    name: 'deploy', type: 'function',
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
  { name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'transfer', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

const IdentityRegistryAbi = [
  { name: 'register', type: 'function', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }], stateMutability: 'nonpayable' },
] as const;

const AgentRegistryAbi = [
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
  { name: 'isRegistered', type: 'function', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
] as const;

// ─── Smart Account Deployment ────────────────────────────

const SMART_ACCOUNTS = [
  { name: 'User', salt: 0n },
  { name: 'LPAgent (Orchestrator)', salt: 1n },
  { name: 'SwapAgent', salt: 2n },
  { name: 'PriceAgent', salt: 3n },
  { name: 'HooksAgent', salt: 4n },
];

async function deploySmartAccount(
  walletClient: any,
  publicClient: any,
  signerAddress: Address,
  salt: bigint,
  name: string,
): Promise<Address> {
  const saltBytes = keccak256(
    encodePacked(['address', 'uint256'], [signerAddress, salt]),
  );

  // Encode HybridDeleGator.initialize(owner, keyIds[], xValues[], yValues[])
  // For ECDSA-only, pass empty arrays for P256 keys
  const initData = encodeFunctionData({
    abi: [{
      name: 'initialize',
      type: 'function',
      inputs: [
        { name: '_owner', type: 'address' },
        { name: '_keyIds', type: 'string[]' },
        { name: '_xValues', type: 'uint256[]' },
        { name: '_yValues', type: 'uint256[]' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    }],
    functionName: 'initialize',
    args: [signerAddress, [], [], []],
  });

  try {
    const deployHash = await walletClient.writeContract({
      address: EXTERNAL.simpleFactory,
      abi: SimpleFactoryAbi,
      functionName: 'deploy',
      args: [EXTERNAL.hybridDeleGatorImpl, initData, saltBytes],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    const smartAccount = receipt.logs[0]?.address as Address;
    console.log(`  ✓ ${name}: ${smartAccount} (tx: ${receipt.transactionHash.slice(0, 18)}...)`);
    return smartAccount;
  } catch (e: any) {
    if (e.message?.includes('already') || e.message?.includes('CREATE2')) {
      // Already deployed — compute the address
      console.log(`  ⏭ ${name}: already deployed (salt=${salt})`);
      return '0x0000000000000000000000000000000000000000' as Address;
    }
    throw e;
  }
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  const signer = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account: signer, chain: baseSepolia, transport: http(RPC_URL) });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       AgentChain Setup — Base Sepolia                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`EOA Signer: ${signer.address}`);

  const ethBal = await publicClient.getBalance({ address: signer.address });
  const usdcBal = await publicClient.readContract({ address: EXTERNAL.usdc, abi: ERC20Abi, functionName: 'balanceOf', args: [signer.address] });
  console.log(`ETH: ${(Number(ethBal) / 1e18).toFixed(4)}`);
  console.log(`USDC: ${(Number(usdcBal) / 1e6).toFixed(2)}\n`);

  // ═══════════════════════════════════════════════════════
  //  PHASE 1: Deploy ERC-4337 Smart Accounts
  // ═══════════════════════════════════════════════════════

  console.log('── Phase 1: Deploying ERC-4337 Smart Accounts ──\n');

  const deployed: Record<string, Address> = {};

  for (const account of SMART_ACCOUNTS) {
    const addr = await deploySmartAccount(walletClient, publicClient, signer.address, account.salt, account.name);
    deployed[account.name] = addr;
  }

  console.log('');

  // ═══════════════════════════════════════════════════════
  //  PHASE 2: Fund Smart Accounts with ETH
  // ═══════════════════════════════════════════════════════

  console.log('── Phase 2: Funding Smart Accounts with ETH ──\n');

  for (const [name, addr] of Object.entries(deployed)) {
    if (addr === '0x0000000000000000000000000000000000000000') continue;

    const balance = await publicClient.getBalance({ address: addr });
    if (balance > parseEther('0.0005')) {
      console.log(`  ⏭ ${name}: already funded (${(Number(balance) / 1e18).toFixed(4)} ETH)`);
      continue;
    }

    const hash = await walletClient.sendTransaction({ to: addr, value: parseEther('0.002') });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ✓ ${name}: funded 0.002 ETH`);
  }

  console.log('');

  // ═══════════════════════════════════════════════════════
  //  PHASE 3: Register Orchestrator in AgentChain
  // ═══════════════════════════════════════════════════════

  console.log('── Phase 3: Registering Orchestrator in AgentChain ──\n');

  const isRegistered = await publicClient.readContract({
    address: CONTRACTS.agentRegistry, abi: AgentRegistryAbi,
    functionName: 'isRegistered', args: [signer.address],
  });

  if (isRegistered) {
    console.log('  ⏭ Orchestrator already registered. Skipping.\n');
  } else {
    // Step 1: ERC-8004 identity
    console.log('  1. Registering ERC-8004 identity...');
    const idHash = await walletClient.writeContract({
      address: EXTERNAL.identityRegistry, abi: IdentityRegistryAbi,
      functionName: 'register', args: ['ipfs://agentchain-orchestrator-v2'],
    });
    const idReceipt = await publicClient.waitForTransactionReceipt({ hash: idHash });
    const erc8004Id = BigInt(idReceipt.logs[0]?.topics?.[3] || '0');
    console.log(`     ERC-8004 ID: ${erc8004Id} (tx: ${idReceipt.transactionHash.slice(0, 18)}...)`);

    // Step 2: Approve USDC
    const stakeAmount = 100000n; // 0.1 USDC
    console.log(`  2. Approving ${Number(stakeAmount) / 1e6} USDC...`);
    const approveHash = await walletClient.writeContract({
      address: EXTERNAL.usdc, abi: ERC20Abi,
      functionName: 'approve', args: [CONTRACTS.agentRegistry, stakeAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Step 3: Register in AgentChain
    console.log('  3. Registering in AgentChain...');
    const capabilities = ['uniswap-swap', 'uniswap-lp', 'uniswap-price', 'uniswap-hooks'];
    const capHashes = capabilities.map(c => keccak256(encodePacked(['string'], [c])));

    const regHash = await walletClient.writeContract({
      address: CONTRACTS.agentRegistry, abi: AgentRegistryAbi,
      functionName: 'registerAndStake',
      args: ['AgentChain Orchestrator', erc8004Id, capHashes, 'http://localhost:3003', stakeAmount],
    });
    const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regHash });
    console.log(`     ✓ Registered! (tx: ${regReceipt.transactionHash.slice(0, 18)}...)`);
    console.log(`     Capabilities: ${capabilities.join(', ')}`);
    console.log(`     Stake: ${Number(stakeAmount) / 1e6} USDC\n`);
  }

  // ═══════════════════════════════════════════════════════
  //  Summary
  // ═══════════════════════════════════════════════════════

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                   Setup Complete                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Smart Accounts (ERC-4337 HybridDeleGator):            ║');
  for (const [name, addr] of Object.entries(deployed)) {
    if (addr !== '0x0000000000000000000000000000000000000000') {
      console.log(`║  ${name.padEnd(25)} ${addr.slice(0, 20)}... ║`);
    }
  }
  console.log('║                                                        ║');
  console.log(`║  EOA (Orchestrator):     ${signer.address.slice(0, 20)}... ║`);
  console.log('║                                                        ║');
  console.log('║  AgentChain Contracts:                                  ║');
  console.log(`║  Registry:    ${CONTRACTS.agentRegistry.slice(0, 20)}...            ║`);
  console.log(`║  Tracker:     ${CONTRACTS.delegationTracker.slice(0, 20)}...            ║`);
  console.log(`║  Enforcer:    ${CONTRACTS.agentCapabilityEnforcer.slice(0, 20)}...            ║`);
  console.log(`║  Arbiter:     ${CONTRACTS.agentChainArbiter.slice(0, 20)}...            ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  // Save deployed addresses for demo scripts
  const fs = await import('node:fs');
  const addressFile = {
    eoa: signer.address,
    smartAccounts: deployed,
    contracts: CONTRACTS,
    external: EXTERNAL,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync('deployed-addresses.json', JSON.stringify(addressFile, null, 2));
  console.log('\nAddresses saved to deployed-addresses.json');

  console.log('\nNext steps:');
  console.log('  1. Start agents: cd agents/uniswap');
  console.log('     npx tsx price-agent/server.ts   # Terminal 1');
  console.log('     npx tsx swap-agent/server.ts    # Terminal 2');
  console.log('     npx tsx lp-agent/server.ts      # Terminal 3');
  console.log('     npx tsx hooks-agent/server.ts   # Terminal 4');
  console.log('  2. Run demo: cd demo && npx tsx submit-intent.ts "Your intent"');
}

main().catch(console.error);
