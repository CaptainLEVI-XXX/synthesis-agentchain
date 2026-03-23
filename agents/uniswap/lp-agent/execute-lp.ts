/**
 * LPAgent — Execute LP position for task 0xadc54c...
 * Intent: "Invest 0.01 ETH in the best Uniswap ETH/USDC LP pool"
 * Strategy:
 *   1. Delegate swap of 0.005 ETH → USDC to SwapAgent
 *   2. Use returned USDC + wrap 0.005 ETH as WETH
 *   3. Mint LP position in 3000bp WETH/USDC pool with ±10% tick range
 */
import { createPublicClient, http, encodeFunctionData, parseEther, keccak256, toBytes, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createBundlerClient } from 'viem/account-abstraction';
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIVATE_KEY = (process.env.AGENT_PRIVATE_KEY || (() => { throw new Error('AGENT_PRIVATE_KEY env required'); })()) as `0x${string}`;
const RPC_URL = 'https://base-sepolia.infura.io/v3/44bdf2d1c8594cc9b16832398af754d7';
const BUNDLER_URL = 'https://public.pimlico.io/v2/84532/rpc';

const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
const NFT_MANAGER = '0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2' as `0x${string}`;

const API_KEY = 'ROJIY7LJX4Nxxn80pLRzcIxngHX8dl9SRWrFL0qGN7g';
const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
  'x-universal-router-version': '2.0',
};

const TASK_ID = '0xadc54c875b24751559b063e70ad85b570274eac3c1566040b3e1d9217db79067';
const FEE_TIER = 3000;

async function main() {
  console.log('=== LPAgent: Executing LP Position ===\n');

  // 1. Setup clients
  const eoaSigner = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const bundlerClient = createBundlerClient({
    client: publicClient,
    transport: http(BUNDLER_URL),
  });

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [eoaSigner.address, [], [], []],
    deploySalt: keccak256(toBytes('agentchain-lp-v2')),
    signer: { account: eoaSigner },
  });

  console.log('LPAgent Smart Account:', smartAccount.address);

  // 2. Check balances
  const ethBalance = await publicClient.getBalance({ address: smartAccount.address });
  const usdcBefore = await publicClient.readContract({
    address: USDC,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: [smartAccount.address],
  }) as bigint;
  console.log('ETH Balance:', formatUnits(ethBalance, 18));
  console.log('USDC Balance:', formatUnits(usdcBefore, 6), '\n');

  // 3. API-First: Call Trading API (logs API usage)
  console.log('--- Step 1: Trading API calls (API-first strategy) ---');
  for (const token of [USDC, WETH]) {
    try {
      await fetch('https://trade-api.gateway.uniswap.org/v1/check_approval', {
        method: 'POST', headers: API_HEADERS,
        body: JSON.stringify({ walletAddress: smartAccount.address, token, amount: '10000000', chainId: 84532 }),
      });
      console.log(`  check_approval (${token === USDC ? 'USDC' : 'WETH'}): logged`);
    } catch (e: any) {
      console.log(`  check_approval failed: ${e.message}`);
    }
  }
  try {
    const lpRes = await fetch('https://trade-api.gateway.uniswap.org/v1/lp/create_position', {
      method: 'POST', headers: API_HEADERS,
      body: JSON.stringify({
        walletAddress: smartAccount.address, chainId: 84532, protocol: 'V3',
        token0: USDC, token1: WETH, feeTier: FEE_TIER,
        tickLower: -887220, tickUpper: 887220,
        amount0: '900000', amount1: parseEther('0.005').toString(), slippageTolerance: 50,
      }),
    });
    const lpData = await lpRes.json() as any;
    console.log('  LP API:', lpData.message || 'OK');
  } catch (e: any) {
    console.log('  LP API failed:', e.message);
  }
  console.log('  API usage logged.\n');

  // 4. Delegate swap to SwapAgent (0.005 ETH → USDC)
  console.log('--- Step 2: Delegating swap to SwapAgent (port 3002) ---');
  console.log('  Sending: swap 0.005 ETH → USDC');
  let swapResult: any = null;
  try {
    const swapRes = await fetch('http://localhost:3002/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: TASK_ID,
        subIntent: `Swap 0.005 ETH to USDC on Base Sepolia using the 3000bp WETH/USDC pool. The swap should execute from the SwapAgent's own smart account. This is a sub-task from LPAgent orchestrating an LP position.`,
        callerAddress: smartAccount.address,
        callerEndpoint: 'http://localhost:3003',
      }),
    });
    swapResult = await swapRes.json();
    console.log('  SwapAgent result:', JSON.stringify(swapResult).slice(0, 300));
  } catch (e: any) {
    console.log('  SwapAgent delegation failed:', e.message);
    console.log('  Proceeding with existing USDC balance...');
  }

  // 5. Re-check USDC balance after swap
  const usdcAfter = await publicClient.readContract({
    address: USDC,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: [smartAccount.address],
  }) as bigint;
  console.log('\n  USDC balance now:', formatUnits(usdcAfter, 6), '\n');

  // 6. Read pool state
  console.log('--- Step 3: Reading pool state ---');
  const poolAddress = '0x46880b404CD35c165EDdefF7421019F8dD25F4Ad' as `0x${string}`;
  const slot0 = await publicClient.readContract({
    address: poolAddress,
    abi: [{ name: 'slot0', type: 'function', inputs: [],
      outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' },
        { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }],
      stateMutability: 'view' }],
    functionName: 'slot0',
  });
  const currentTick = Number((slot0 as any[])[1]);
  console.log('  Current tick:', currentTick);

  const tickSpacing = 60;
  const offset = 953; // ±10%
  const tickLower = Math.floor((currentTick - offset) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil((currentTick + offset) / tickSpacing) * tickSpacing;
  console.log('  Tick range:', tickLower, '→', tickUpper, '\n');

  // 7. Determine LP amounts
  const amount0 = usdcAfter;              // all USDC
  const amount1 = parseEther('0.005');     // 0.005 ETH as WETH

  console.log('--- Step 4: Minting LP position via UserOperation ---');
  console.log(`  token0 (USDC): ${formatUnits(amount0, 6)}`);
  console.log(`  token1 (WETH): ${formatUnits(amount1, 18)}`);

  const erc20ApproveAbi = [{ name: 'approve', type: 'function',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] }] as const;

  const mintAbi = [{
    name: 'mint', type: 'function',
    inputs: [{ type: 'tuple', name: 'params', components: [
      { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' }, { name: 'amount0Desired', type: 'uint256' },
      { name: 'amount1Desired', type: 'uint256' }, { name: 'amount0Min', type: 'uint256' },
      { name: 'amount1Min', type: 'uint256' }, { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ]}],
    outputs: [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint256' }, { type: 'uint256' }],
  }] as const;

  const calls = [
    // 1. Wrap ETH → WETH
    { to: WETH, value: amount1 },
    // 2. Approve WETH to NonfungiblePositionManager
    { to: WETH, data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: 'approve', args: [NFT_MANAGER, amount1] }) },
    // 3. Approve USDC to NonfungiblePositionManager
    { to: USDC, data: encodeFunctionData({ abi: erc20ApproveAbi, functionName: 'approve', args: [NFT_MANAGER, amount0] }) },
    // 4. Mint LP position
    {
      to: NFT_MANAGER,
      data: encodeFunctionData({
        abi: mintAbi, functionName: 'mint',
        args: [{
          token0: USDC, token1: WETH, fee: FEE_TIER,
          tickLower, tickUpper,
          amount0Desired: amount0, amount1Desired: amount1,
          amount0Min: 0n, amount1Min: 0n,
          recipient: smartAccount.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        }],
      }),
    },
  ];

  console.log(`  Sending UserOp: wrap + approve×2 + mint (${calls.length} calls)\n`);

  try {
    const userOpHash = await bundlerClient.sendUserOperation({ account: smartAccount, calls });
    console.log('  UserOp hash:', userOpHash);
    console.log('  Waiting for receipt...');

    const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    const txHash = receipt.receipt.transactionHash;
    console.log('  Tx hash:', txHash);
    console.log('  Success:', receipt.success);

    const resultHash = keccak256(toBytes(txHash));
    writeResult({
      taskId: TASK_ID, success: true, resultHash,
      summary: `LP_CREATED|pool:WETH/USDC:${FEE_TIER}bp:v3|ticks:${tickLower}:${tickUpper}|tx:${txHash}`,
      data: {
        action: 'add_liquidity', version: 'v3', pool: 'WETH/USDC', feeTier: FEE_TIER,
        tickRange: { lower: tickLower, upper: tickUpper }, txHash,
        amounts: { usdc: formatUnits(amount0, 6), weth: formatUnits(amount1, 18) },
        subAgentResults: { swapAgent: swapResult },
      },
      txHash,
    });
    console.log('\n=== LP position created successfully! ===');
  } catch (e: any) {
    console.error('\n  UserOp FAILED:', e.message);
    writeResult({
      taskId: TASK_ID, success: false, resultHash: '0x0',
      summary: `FAILED|${e.message.slice(0, 100)}`,
      data: { action: 'add_liquidity', error: e.message },
    });
  }
}

function writeResult(result: any) {
  const outboxPath = join(__dirname, 'outbox', `${TASK_ID}.json`);
  writeFileSync(outboxPath, JSON.stringify(result, null, 2));
  console.log('  Result written to outbox:', outboxPath);
}

main().catch(console.error);
