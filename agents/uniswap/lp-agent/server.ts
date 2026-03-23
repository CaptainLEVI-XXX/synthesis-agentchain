/**
 * LPAgent — HTTP message bus (Orchestrator)
 *
 * This server is just the communication layer. The intelligence lives in the
 * Claude Code session running in this terminal, guided by SKILL.md.
 *
 * LPAgent is both a worker AND an orchestrator:
 *   - As orchestrator: decomposes intents, delegates to SwapAgent via HTTP
 *   - As worker: executes LP operations directly
 *
 * When a task arrives:
 *   1. Task is written to inbox/{taskId}.json
 *   2. Console prints task details
 *   3. The Claude Code session (you) reads the task and processes it
 *   4. You may delegate sub-tasks by POSTing to http://localhost:3002/task (SwapAgent)
 *   5. You write the result to outbox/{taskId}.json
 *   6. Server picks up the result and returns it via HTTP
 *
 * Start: npx tsx server.ts
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from '../shared/server-base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = createAgentServer({
  name: 'LPAgent',
  port: 3003,
  smartAccount: '0xb378619B36F027FA54289498759f914c1322479A',
  capabilities: ['uniswap-lp'],
  minFee: 100000n, // 0.1 USDC
  workDir: __dirname,
});

server.start();
