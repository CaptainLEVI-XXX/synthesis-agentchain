import type { MechInfo, MechResult } from '../types/index.js';

export type TaskSpec = {
  prompt: string;
  mechType?: string;
};

export class OlasBridgeModule {
  async discoverMechs(capability: string): Promise<MechInfo[]> {
    try {
      // mech-client is an optional dependency
      const mechClient = await import('mech-client');
      const client = new mechClient.MechClient({ chain: 'base' });
      return [];
    } catch {
      return [];
    }
  }

  async hireMech(task: TaskSpec): Promise<MechResult> {
    try {
      const mechClient = await import('mech-client');
      const client = new mechClient.MechClient({ chain: 'base' });
      const result = await client.request({
        prompt: task.prompt,
        tool: task.mechType ?? 'openai-gpt4',
      });
      return { output: result.output ?? '', txHash: result.txHash as `0x${string}` | undefined };
    } catch (e) {
      throw new Error(
        `Olas mech-client not available: ${e instanceof Error ? e.message : 'unknown error'}`,
      );
    }
  }
}
