declare module 'mech-client' {
  export class MechClient {
    constructor(config: { chain: string });
    request(params: { prompt: string; tool: string }): Promise<{
      output?: string;
      txHash?: string;
    }>;
  }
}
