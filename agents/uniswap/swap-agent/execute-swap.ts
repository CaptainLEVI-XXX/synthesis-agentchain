/**
 * Execute swap task: 0.005 ETH → USDC on Base Sepolia via direct SwapRouter02
 * Recipient: LPAgent smart account 0xb378619B36F027FA54289498759f914c1322479A
 */
import { createPublicClient, http, encodeFunctionData, parseEther, keccak256, toBytes, toHex, stringToHex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createBundlerClient } from 'viem/account-abstraction';
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TASK_ID = '0xadc54c875b24751559b063e70ad85b570274eac3c1566040b3e1d9217db79067';
const LP_AGENT_ADDRESS = '0xb378619B36F027FA54289498759f914c1322479A' as const;
const SWAP_ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const AMOUNT_IN = parseEther('0.005');

async function main() {
  console.log('=== SwapAgent: Executing swap 0.005 ETH → USDC ===');
  console.log(`Recipient: ${LP_AGENT_ADDRESS} (LPAgent)`);

  // 1. Setup clients
  const eoaSigner = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
  const transport = http('https://base-sepolia.infura.io/v3/44bdf2d1c8594cc9b16832398af754d7');
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  const bundlerClient = createBundlerClient({
    client: publicClient,
    transport: http('https://public.pimlico.io/v2/84532/rpc'),
  });

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [eoaSigner.address, [], [], []],
    deploySalt: keccak256(toBytes('agentchain-swap-v2')),
    signer: { account: eoaSigner },
  });

  console.log(`Smart account: ${smartAccount.address}`);

  // 2. Check ETH balance
  const ethBalance = await publicClient.getBalance({ address: smartAccount.address });
  console.log(`ETH balance: ${ethBalance} wei (${Number(ethBalance) / 1e18} ETH)`);

  if (ethBalance < AMOUNT_IN) {
    throw new Error(`Insufficient ETH balance: have ${ethBalance}, need ${AMOUNT_IN}`);
  }

  // 3. Execute swap: wrap ETH → WETH, approve WETH → SwapRouter, swap WETH → USDC
  // Recipient is LPAgent's smart account as requested
  console.log('Sending UserOperation: wrap + approve + swap...');

  const swapRouterAbi = [{
    name: 'exactInputSingle', type: 'function' as const,
    inputs: [{ type: 'tuple' as const, components: [
      { name: 'tokenIn', type: 'address' as const },
      { name: 'tokenOut', type: 'address' as const },
      { name: 'fee', type: 'uint24' as const },
      { name: 'recipient', type: 'address' as const },
      { name: 'amountIn', type: 'uint256' as const },
      { name: 'amountOutMinimum', type: 'uint256' as const },
      { name: 'sqrtPriceLimitX96', type: 'uint160' as const },
    ]}],
    outputs: [{ type: 'uint256' as const }],
    stateMutability: 'payable' as const,
  }];

  const erc20ApproveAbi = [{
    name: 'approve', type: 'function' as const,
    inputs: [{ type: 'address' as const }, { type: 'uint256' as const }],
    outputs: [{ type: 'bool' as const }],
    stateMutability: 'nonpayable' as const,
  }];

  const userOpHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [
      // Step 1: Wrap ETH → WETH
      { to: WETH, value: AMOUNT_IN },
      // Step 2: Approve WETH to SwapRouter02
      {
        to: WETH,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: 'approve',
          args: [SWAP_ROUTER, AMOUNT_IN],
        }),
      },
      // Step 3: Swap WETH → USDC, send to LPAgent
      {
        to: SWAP_ROUTER,
        data: encodeFunctionData({
          abi: swapRouterAbi,
          functionName: 'exactInputSingle',
          args: [{
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 3000,
            recipient: LP_AGENT_ADDRESS,
            amountIn: AMOUNT_IN,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          }],
        }),
      },
    ],
  });

  console.log(`UserOp hash: ${userOpHash}`);
  console.log('Waiting for receipt...');

  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  const txHash = receipt.receipt.transactionHash;
  const success = receipt.success;

  console.log(`Tx hash: ${txHash}`);
  console.log(`Success: ${success}`);

  if (!success) {
    // Write failure to outbox
    const result = {
      taskId: TASK_ID,
      success: false,
      resultHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      summary: `SWAP_FAILED|txHash:${txHash}|reason:UserOp reverted`,
      data: { routing: 'DIRECT_V3', txHash, error: 'UserOp reverted' },
      txHash,
    };
    writeFileSync(join(__dirname, 'outbox', `${TASK_ID}.json`), JSON.stringify(result, null, 2));
    console.log('Written failure to outbox.');
    return;
  }

  // 4. Read USDC balance of LPAgent to confirm
  const usdcBalance = await publicClient.readContract({
    address: USDC,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as const,
    functionName: 'balanceOf',
    args: [LP_AGENT_ADDRESS],
  });
  console.log(`LPAgent USDC balance after swap: ${usdcBalance} (${Number(usdcBalance) / 1e6} USDC)`);

  // 5. Write success result to outbox
  const resultHash = keccak256(toHex(txHash));
  const summary = `SWAP_EXECUTED|type:DIRECT_V3|tokenIn:${WETH}|amountIn:${AMOUNT_IN.toString()}|tokenOut:${USDC}|recipient:${LP_AGENT_ADDRESS}|txHash:${txHash}|chain:84532`;

  const result = {
    taskId: TASK_ID,
    success: true,
    resultHash,
    summary,
    data: {
      routing: 'DIRECT_V3',
      amountIn: AMOUNT_IN.toString(),
      tokenIn: WETH,
      tokenOut: USDC,
      feeTier: 3000,
      recipient: LP_AGENT_ADDRESS,
      txHash,
    },
    txHash,
  };

  writeFileSync(join(__dirname, 'outbox', `${TASK_ID}.json`), JSON.stringify(result, null, 2));
  console.log('Written result to outbox. Swap complete!');
}

main().catch((err) => {
  console.error('Swap execution failed:', err);

  // Write error to outbox so server doesn't time out
  const result = {
    taskId: TASK_ID,
    success: false,
    resultHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    summary: `SWAP_FAILED|error:${err.message}`,
    data: { error: err.message },
    txHash: null,
  };
  writeFileSync(join(__dirname, 'outbox', `${TASK_ID}.json`), JSON.stringify(result, null, 2));
  console.log('Written error to outbox.');
});
