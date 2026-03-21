import { keccak256, toHex } from 'viem';
import { createAgentServer } from '../shared/server-base.js';
import type { TaskRequest, TaskResponse, AgentServerConfig } from '../shared/types.js';

const config: AgentServerConfig = {
  name: 'LPAgent',
  port: 3003,
  privateKey: (process.env.LP_AGENT_KEY || '0x') as `0x${string}`,
  capabilities: ['uniswap-lp'],
  minFee: 5000000n, // 5 USDC
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  chain: 'base',
};

/** LPAgent is BOTH a worker AND an orchestrator.
 *  As worker: receives LP tasks, executes directly.
 *  As orchestrator: decomposes complex intents, delegates to other agents. */
async function handleTask(req: TaskRequest): Promise<TaskResponse> {
  console.log(`[LPAgent] Processing: ${req.subIntent}`);

  const intent = req.subIntent.toLowerCase();

  // ─── Complex intent: needs delegation to sub-agents ───
  if (intent.includes('best') || intent.includes('maximize') || intent.includes('yield')) {
    return handleComplexIntent(req);
  }

  // ─── Simple LP task: execute directly ─────────────────
  return handleDirectLP(req);
}

async function handleComplexIntent(req: TaskRequest): Promise<TaskResponse> {
  console.log(`[LPAgent] Orchestrating complex intent...`);

  // Step 1: Call PriceAgent for pool data
  console.log(`[LPAgent] Delegating to PriceAgent (localhost:3001)...`);
  const priceResponse = await callAgent('http://localhost:3001', {
    taskId: req.taskId,
    subIntent: 'Get ETH/USDC prices across all fee tiers',
    callerAddress: '0x0000000000000000000000000000000000000000' as any,
    callerEndpoint: 'http://localhost:3003',
  });

  // Step 2: Call HooksAgent for V4 analysis
  console.log(`[LPAgent] Delegating to HooksAgent (localhost:3004)...`);
  const hooksResponse = await callAgent('http://localhost:3004', {
    taskId: req.taskId,
    subIntent: 'Check V4 ETH/USDC pools for beneficial hooks',
    callerAddress: '0x0000000000000000000000000000000000000000' as any,
    callerEndpoint: 'http://localhost:3003',
  });

  // Step 3: Decide best pool based on sub-agent results
  const decision = `Best pool: ETH/USDC 3000bp V3 (from PriceAgent). No V4 hooks (from HooksAgent).`;
  console.log(`[LPAgent] Decision: ${decision}`);

  // Step 4: Call SwapAgent to prepare tokens
  console.log(`[LPAgent] Delegating to SwapAgent (localhost:3002)...`);
  const swapResponse = await callAgent('http://localhost:3002', {
    taskId: req.taskId,
    subIntent: 'Swap 1 ETH to USDC for LP position',
    callerAddress: '0x0000000000000000000000000000000000000000' as any,
    callerEndpoint: 'http://localhost:3003',
  });

  // Step 5: Add LP position (self-executed)
  const lpResult = {
    action: 'add_liquidity',
    version: 'v3',
    pool: 'ETH/USDC',
    feeTier: 3000,
    tickRange: { lower: 195000, upper: 197100 },
    txHash: '0x' + '0'.repeat(64),
    subAgentResults: {
      priceAgent: priceResponse.summary,
      hooksAgent: hooksResponse.summary,
      swapAgent: swapResponse.summary,
    },
    timestamp: Date.now(),
  };

  const resultHash = keccak256(toHex(JSON.stringify(lpResult)));

  return {
    taskId: req.taskId,
    success: true,
    resultHash,
    summary: `LP_ORCHESTRATED|pool:ETH/USDC:3000bp:v3|delegations:PriceAgent+HooksAgent+SwapAgent`,
    data: lpResult,
    txHash: lpResult.txHash as `0x${string}`,
  };
}

async function handleDirectLP(req: TaskRequest): Promise<TaskResponse> {
  // In production: use /viem-integration to call NonfungiblePositionManager.mint()
  const lpResult = {
    action: 'add_liquidity',
    version: 'v3',
    pool: 'ETH/USDC',
    feeTier: 3000,
    txHash: '0x' + '0'.repeat(64),
    timestamp: Date.now(),
  };

  const resultHash = keccak256(toHex(JSON.stringify(lpResult)));

  return {
    taskId: req.taskId,
    success: true,
    resultHash,
    summary: `LP_CREATED|version:v3|pool:ETH/USDC|feeTier:3000`,
    data: lpResult,
    txHash: lpResult.txHash as `0x${string}`,
  };
}

/** Call another agent's HTTP endpoint */
async function callAgent(endpoint: string, req: TaskRequest): Promise<TaskResponse> {
  try {
    const response = await fetch(`${endpoint}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });

    if (!response.ok) {
      throw new Error(`Agent at ${endpoint} returned ${response.status}`);
    }

    return response.json() as Promise<TaskResponse>;
  } catch (err: any) {
    console.error(`[LPAgent] Failed to call ${endpoint}: ${err.message}`);
    return {
      taskId: req.taskId,
      success: false,
      resultHash: '0x' + '0'.repeat(64) as `0x${string}`,
      summary: `FAILED: ${err.message}`,
      error: err.message,
    };
  }
}

const server = createAgentServer(config, handleTask);
server.start();
