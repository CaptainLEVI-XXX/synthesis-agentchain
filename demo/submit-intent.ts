/**
 * AgentChain Live Demo — Submit Intent
 *
 * EOA user submits a DeFi intent on-chain, then sends it to the
 * LPAgent orchestrator via HTTP. The orchestrator decomposes the
 * intent and delegates to sub-agents.
 *
 * Flow:
 *   1. EOA approves USDC to DelegationTracker
 *   2. EOA calls registerTask() — posts intent on-chain with feePool
 *   3. HTTP POST to LPAgent (localhost:3003) with the task
 *   4. Wait for LPAgent to process and return result
 *
 * Prerequisites:
 *   - Agent servers running (swap-agent:3002, lp-agent:3003)
 *   - Agents registered on-chain (run fund-and-register.ts first)
 *   - EOA has USDC on Base Sepolia
 *
 * Usage:
 *   cd demo && npx tsx submit-intent.ts "Invest 0.01 ETH in Uniswap LP"
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  toHex,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { PRIVATE_KEY, RPC_URL, CONTRACTS, EXTERNAL } from './config.js';

// ─── Setup ──────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

// ─── ABIs ───────────────────────────────────────────────
const ERC20_ABI = [
  { name: 'approve', type: 'function', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'allowance', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

const TRACKER_ABI = [
  {
    name: 'registerTask', type: 'function',
    inputs: [
      { name: 'taskId', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
      { name: 'deposit', type: 'uint256' },
      { name: 'feePool', type: 'uint256' },
      { name: 'intent', type: 'string' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
] as const;

// ─── Main ───────────────────────────────────────────────
async function main() {
  const intent = process.argv[2] || 'Invest 0.01 ETH in the best Uniswap ETH/USDC LP pool';
  const feePool = 500_000n; // 0.5 USDC for agent fees
  const deposit = 1_000_000n; // 1 USDC reference deposit
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24 hours
  const taskId = keccak256(toBytes(`agentchain-demo-${Date.now()}`));

  console.log('═══════════════════════════════════════════════════════');
  console.log('  AgentChain — Submit Intent');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  User (EOA):  ${account.address}`);
  console.log(`  Intent:      ${intent}`);
  console.log(`  Task ID:     ${taskId}`);
  console.log(`  Fee Pool:    ${Number(feePool) / 1e6} USDC`);
  console.log('');

  // ─── Step 1: Check balances ───────────────────────────
  const usdcBal = await publicClient.readContract({
    address: EXTERNAL.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`  USDC balance: ${Number(usdcBal) / 1e6}`);

  if (usdcBal < feePool) {
    console.error('  ERROR: Insufficient USDC for feePool');
    process.exit(1);
  }

  // ─── Step 2: Approve USDC to DelegationTracker ────────
  const allowance = await publicClient.readContract({
    address: EXTERNAL.usdc, abi: ERC20_ABI,
    functionName: 'allowance', args: [account.address, CONTRACTS.delegationTracker],
  });

  if (allowance < feePool) {
    console.log('  Approving USDC to DelegationTracker...');
    const approveTx = await walletClient.writeContract({
      address: EXTERNAL.usdc, abi: ERC20_ABI,
      functionName: 'approve', args: [CONTRACTS.delegationTracker, 100_000_000n], // 100 USDC max
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`  Approved — tx: ${approveTx.slice(0, 22)}...`);
  } else {
    console.log('  USDC already approved');
  }

  // ─── Step 3: Register task on-chain ───────────────────
  console.log('  Registering task on-chain...');
  const registerTx = await walletClient.writeContract({
    address: CONTRACTS.delegationTracker, abi: TRACKER_ABI,
    functionName: 'registerTask',
    args: [taskId, deadline, deposit, feePool, intent],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerTx });
  console.log(`  Task registered — tx: ${registerTx}`);
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  View: https://sepolia.basescan.org/tx/${registerTx}`);

  // ─── Step 4: Send task to LPAgent orchestrator ────────
  console.log('');
  console.log('  Sending task to LPAgent (http://localhost:3003/task)...');

  const taskRequest = {
    taskId,
    subIntent: intent,
    callerAddress: account.address,
    callerEndpoint: 'none', // EOA user, no callback
  };

  try {
    const response = await fetch('http://localhost:3003/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskRequest),
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    });

    if (!response.ok) {
      throw new Error(`LPAgent returned ${response.status}: ${await response.text()}`);
    }

    const result = await response.json() as any;

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  TASK COMPLETED');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Success:     ${result.success}`);
    console.log(`  Summary:     ${result.summary}`);
    if (result.txHash) console.log(`  Tx Hash:     ${result.txHash}`);
    if (result.data) console.log(`  Data:        ${JSON.stringify(result.data, null, 2)}`);

  } catch (err: any) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.log('');
      console.log('  LPAgent server not running!');
      console.log('  Start it first: cd agents/uniswap && npx tsx lp-agent/server.ts');
      console.log('');
      console.log('  Task is registered on-chain. The orchestrator can claim it later.');
      console.log(`  Task ID: ${taskId}`);
    } else {
      console.error(`  Error: ${err.message}`);
    }
  }
}

main().catch(console.error);
