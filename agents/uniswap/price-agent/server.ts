import { keccak256, toHex } from 'viem';
import { createAgentServer } from '../shared/server-base.js';
import type { TaskRequest, TaskResponse, AgentServerConfig } from '../shared/types.js';

const config: AgentServerConfig = {
  name: 'PriceAgent',
  port: 3001,
  privateKey: (process.env.PRICE_AGENT_KEY || '0x') as `0x${string}`,
  capabilities: ['uniswap-price'],
  minFee: 500000n, // 0.5 USDC
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  chain: 'base',
};

async function handleTask(req: TaskRequest): Promise<TaskResponse> {
  console.log(`[PriceAgent] Processing: ${req.subIntent}`);

  // In production: use /viem-integration plugin to read pool state
  // and /swap-integration plugin for Trading API quotes.
  // For now: return structured price data.

  const priceData = {
    timestamp: Date.now(),
    pair: 'ETH/USDC',
    pools: [
      { feeTier: 500, price: 2501.23, liquidity: '1.2e15', version: 'v3' },
      { feeTier: 3000, price: 2500.45, liquidity: '9.8e15', version: 'v3' },
      { feeTier: 10000, price: 2499.87, liquidity: '5.6e14', version: 'v3' },
    ],
    bestRoute: { routing: 'DUTCH_V2', amountOut: '2501230000', gasEstimate: '0' },
    recommendation: 'ETH/USDC:3000bp — highest liquidity',
  };

  const resultHash = keccak256(toHex(JSON.stringify(priceData)));

  return {
    taskId: req.taskId,
    success: true,
    resultHash,
    summary: `PRICE_DATA|ETH/USDC|3000bp=$2500.45|liquidity=9.8e15|best_route=DUTCH_V2`,
    data: priceData,
  };
}

const server = createAgentServer(config, handleTask);
server.start();
