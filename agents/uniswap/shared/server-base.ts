import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type {
  TaskRequest,
  TaskResponse,
  AgentInfoResponse,
  HealthResponse,
  AgentServerConfig,
} from './types.js';

/**
 * AgentChain Agent Server — File-based message bus for Claude Code agents.
 *
 * When a task arrives via HTTP POST /task:
 *   1. Writes task to inbox/{taskId}.json
 *   2. Prints task details to console (so the Claude session sees it)
 *   3. Polls for outbox/{taskId}.json (the Claude session writes this after processing)
 *   4. Returns the result as HTTP response
 *
 * The Claude Code agent session:
 *   1. Sees "NEW TASK" in console output
 *   2. Reads inbox/{taskId}.json
 *   3. Processes it using SKILL.md (real on-chain calls, Trading API, etc.)
 *   4. Writes result to outbox/{taskId}.json
 *
 * Routes:
 *   POST /task     → file-based task routing (waits for Claude to process)
 *   GET  /health   → health check
 *   GET  /info     → agent capabilities
 */
export function createAgentServer(config: AgentServerConfig) {
  const startTime = Date.now();
  let tasksCompleted = 0;

  // Create inbox/outbox directories
  const baseDir = config.workDir || process.cwd();
  const inboxDir = join(baseDir, 'inbox');
  const outboxDir = join(baseDir, 'outbox');
  mkdirSync(inboxDir, { recursive: true });
  mkdirSync(outboxDir, { recursive: true });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ─── POST /task — receive task, write to inbox, wait for outbox ───
      if (req.method === 'POST' && url.pathname === '/task') {
        const body = await readBody(req);
        const taskReq: TaskRequest = JSON.parse(body);
        const taskId = taskReq.taskId;

        // Write task to inbox
        const inboxFile = join(inboxDir, `${taskId}.json`);
        writeFileSync(inboxFile, JSON.stringify(taskReq, null, 2));

        // Print prominently so Claude session sees it
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`  NEW TASK RECEIVED — ${config.name}`);
        console.log('═══════════════════════════════════════════════════════');
        console.log(`  Task ID:    ${taskId}`);
        console.log(`  Intent:     ${taskReq.subIntent}`);
        console.log(`  From:       ${taskReq.callerAddress}`);
        console.log(`  Inbox file: ${inboxFile}`);
        console.log('');
        console.log('  → Read the task file and process it according to your SKILL.md');
        console.log(`  → Write result to: outbox/${taskId}.json`);
        console.log('═══════════════════════════════════════════════════════');
        console.log('');

        // Poll for outbox result (timeout: 5 minutes)
        const outboxFile = join(outboxDir, `${taskId}.json`);
        const timeout = 300_000;
        const pollInterval = 1_000;
        const startPoll = Date.now();

        const result = await new Promise<TaskResponse>((resolve, reject) => {
          const poll = setInterval(() => {
            if (existsSync(outboxFile)) {
              clearInterval(poll);
              try {
                const data = readFileSync(outboxFile, 'utf-8');
                const response: TaskResponse = JSON.parse(data);
                unlinkSync(outboxFile); // clean up
                unlinkSync(inboxFile);
                tasksCompleted++;
                resolve(response);
              } catch (e: any) {
                reject(new Error(`Failed to parse outbox: ${e.message}`));
              }
            } else if (Date.now() - startPoll > timeout) {
              clearInterval(poll);
              reject(new Error('Task timed out waiting for agent response (5 min)'));
            }
          }, pollInterval);
        });

        console.log(`[${config.name}] Task completed: ${result.summary}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // ─── GET /health ─────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/health') {
        const health: HealthResponse = {
          status: 'ok',
          name: config.name,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          tasksCompleted,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
        return;
      }

      // ─── GET /info ───────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/info') {
        const info: AgentInfoResponse = {
          name: config.name,
          address: config.smartAccount,
          capabilities: config.capabilities,
          endpoint: `http://localhost:${config.port}`,
          minFee: config.minFee.toString(),
          stake: '0',
          status: 'ready',
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err: any) {
      console.error(`[${config.name}] Error:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  return {
    start: () => {
      server.listen(config.port, () => {
        console.log('');
        console.log(`[${config.name}] Agent server started`);
        console.log(`  HTTP:         http://localhost:${config.port}`);
        console.log(`  Smart Acct:   ${config.smartAccount}`);
        console.log(`  Capabilities: ${config.capabilities.join(', ')}`);
        console.log(`  Inbox:        ${inboxDir}/`);
        console.log(`  Outbox:       ${outboxDir}/`);
        console.log('');
        console.log('  Waiting for tasks...');
        console.log('');
      });
    },
    stop: () => server.close(),
    server,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
