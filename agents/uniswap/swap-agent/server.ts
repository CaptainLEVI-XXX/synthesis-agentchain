import { keccak256, toHex } from 'viem';
import { createAgentServer } from '../shared/server-base.js';
import type { TaskRequest, TaskResponse, AgentServerConfig } from '../shared/types.js';

const config: AgentServerConfig = {
  name: 'SwapAgent',
  port: 3002,
  privateKey: (process.env.SWAP_AGENT_KEY || '0x') as `0x${string}`,
  capabilities: ['uniswap-swap', 'uniswap-gasless'],
  minFee: 2000000n, // 2 USDC
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  chain: 'base',
};

async function handleTask(req: TaskRequest): Promise<TaskResponse> {
  console.log(`[SwapAgent] Processing: ${req.subIntent}`);

  // In production: use /swap-integration plugin for the full
  // Trading API flow: /check_approval → /quote → /swap or /order

  const swapResult = {
    type: 'CLASSIC',
    tokenIn: '0x4200000000000000000000000000000000000006', // WETH
    tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    amountIn: '1000000000000000000', // 1 ETH
    amountOut: '2501230000', // 2501.23 USDC
    txHash: '0x' + '0'.repeat(64), // placeholder
    timestamp: Date.now(),
  };

  const resultHash = keccak256(toHex(JSON.stringify(swapResult)));

  return {
    taskId: req.taskId,
    success: true,
    resultHash,
    summary: `SWAP_EXECUTED|type:CLASSIC|1 ETH -> 2501.23 USDC|txHash:${swapResult.txHash}`,
    data: swapResult,
    txHash: swapResult.txHash as `0x${string}`,
  };
}

const server = createAgentServer(config, handleTask);
server.start();
