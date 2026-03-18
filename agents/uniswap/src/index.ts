import { type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  UniAgentConfig,
  Intent,
  ExecutionResult,
} from './types.js';
import { SwapType } from './types.js';
import { UniswapApiClient } from './api.js';
import { SwapModule } from './swap.js';
import { QuoteModule } from './quotes.js';
import { OrchestratorModule } from './orchestrator.js';

export class UniAgent {
  readonly config: UniAgentConfig;
  private api!: UniswapApiClient;
  private swap!: SwapModule;
  private quotes!: QuoteModule;
  private smartAccountAddress?: Address;

  private constructor(config: UniAgentConfig) {
    this.config = config;
  }

  static create(config: UniAgentConfig): UniAgent {
    const agent = new UniAgent(config);
    agent.api = new UniswapApiClient(config.uniswapApiKey);
    return agent;
  }

  async register(): Promise<{ smartAccountAddress: Address }> {
    const signer = privateKeyToAccount(this.config.privateKey);
    this.smartAccountAddress = signer.address;

    this.swap = new SwapModule({
      api: this.api,
      swapperAddress: this.smartAccountAddress,
      defaultSlippage: this.config.defaultSlippage,
      signAndBroadcast: async (_tx) => {
        throw new Error('signAndBroadcast not wired — requires walletClient setup');
      },
      signPermit: async (_permitData) => {
        throw new Error('signPermit not wired — requires walletClient setup');
      },
    });

    this.quotes = new QuoteModule({
      api: this.api,
      swapperAddress: this.smartAccountAddress,
    });

    return { smartAccountAddress: this.smartAccountAddress };
  }

  async handleIntent(taskId: Hex, intent: Intent): Promise<ExecutionResult> {
    const plan = OrchestratorModule.decomposeIntent(intent);
    const txHashes: Hex[] = [];
    const orderIds: string[] = [];
    const delegations: { agent: Address; capability: string }[] = [];

    for (const step of plan.steps) {
      if (step.type === 'self') {
        if (intent.inputToken && intent.inputAmount) {
          const result = await this.swap.executeSwapIntent({
            tokenIn: intent.inputToken,
            tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
            amount: intent.inputAmount,
            type: SwapType.EXACT_INPUT,
            slippageTolerance: this.config.defaultSlippage,
          });
          if (result.txHash) txHashes.push(result.txHash);
          if (result.orderId) orderIds.push(result.orderId);
        }
      } else {
        delegations.push({
          agent: '0x0000000000000000000000000000000000000000' as Address,
          capability: step.capability ?? 'unknown',
        });
      }
    }

    return {
      txHashes,
      orderIds,
      delegations,
      success: true,
      summary: `Executed ${txHashes.length} txs, ${orderIds.length} orders, ${delegations.length} delegations`,
    };
  }
}

// Re-export all modules
export { UniswapApiClient } from './api.js';
export { SwapModule } from './swap.js';
export { QuoteModule } from './quotes.js';
export { LiquidityModule } from './liquidity.js';
export { OrchestratorModule } from './orchestrator.js';
export { encodeBatchCalls, buildApproveCall, buildSwapCalldata } from './batch.js';
export * from './types.js';
