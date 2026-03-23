/**
 * SwapAgent — HTTP message bus
 *
 * This server is just the communication layer. The intelligence lives in the
 * Claude Code session running in this terminal, guided by SKILL.md.
 *
 * When a task arrives:
 *   1. Task is written to inbox/{taskId}.json
 *   2. Console prints task details
 *   3. The Claude Code session (you) reads the task and processes it
 *   4. You write the result to outbox/{taskId}.json
 *   5. Server picks up the result and returns it via HTTP
 *
 * Start: npx tsx server.ts
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from '../shared/server-base.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = createAgentServer({
  name: 'SwapAgent',
  port: 3002,
  smartAccount: '0x086d25AA4Ce248e1Ca493232D02a5eec768fB0d7',
  capabilities: ['uniswap-swap', 'uniswap-gasless'],
  minFee: 100000n, // 0.1 USDC
  workDir: __dirname,
});

server.start();
