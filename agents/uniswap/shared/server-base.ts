import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  TaskRequest,
  TaskResponse,
  AgentInfoResponse,
  HealthResponse,
  AgentServerConfig,
} from './types.js';

type TaskHandler = (req: TaskRequest) => Promise<TaskResponse>;

/**
 * Creates an HTTP server for an AgentChain agent.
 *
 * Routes:
 *   POST /task     → receives sub-task from orchestrator, returns result
 *   GET  /health   → health check
 *   GET  /info     → agent capabilities and status
 */
export function createAgentServer(config: AgentServerConfig, handler: TaskHandler) {
  const startTime = Date.now();
  let tasksCompleted = 0;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ─── POST /task — receive and process sub-task ───
      if (req.method === 'POST' && url.pathname === '/task') {
        const body = await readBody(req);
        const taskReq: TaskRequest = JSON.parse(body);

        console.log(`[${config.name}] Received task: ${taskReq.subIntent}`);

        const result = await handler(taskReq);
        tasksCompleted++;

        console.log(`[${config.name}] Completed: ${result.summary}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // ─── GET /health — health check ─────────────────
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

      // ─── GET /info — agent info ─────────────────────
      if (req.method === 'GET' && url.pathname === '/info') {
        const info: AgentInfoResponse = {
          name: config.name,
          address: '0x0000000000000000000000000000000000000000' as any, // set after registration
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

      // ─── 404 ────────────────────────────────────────
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
        console.log(`[${config.name}] listening on http://localhost:${config.port}`);
        console.log(`  Capabilities: ${config.capabilities.join(', ')}`);
        console.log(`  Min fee: ${Number(config.minFee) / 1e6} USDC`);
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
