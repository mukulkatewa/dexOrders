/**
 * Orca Worker - Handles quote fetching and swap execution for Orca DEX
 * PHASE 3: Enhanced with detailed status updates and transaction stages
 * 
 * Key Features:
 * - Processes jobs from 'orca-dex' queue
 * - Emits detailed status updates via process.emit() events
 * - Realistic delays (2-5 seconds) for network simulation
 * - Progress tracking with job.updateProgress()
 * - Whirlpool-specific messages for concentrated liquidity
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { MockDexRouter } from '../services/mockDexRouter';

// Job data structure
interface DexJobData {
  jobType: 'quote' | 'swap';
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  dex: string;
  strategy?: string;
  wallet?: string;
}

// Status update structure
interface OrderStatusUpdate {
  orderId: string;
  status: string;
  timestamp: string;
  [key: string]: any;
}

/**
 * Create Orca Worker
 * Processes quote and swap jobs for Orca DEX (Whirlpool)
 */
export function createOrcaWorker(connection: IORedis): Worker {
  const dexRouter = new MockDexRouter();

  const worker = new Worker<DexJobData>('orca-dex', async (job: Job<DexJobData>) => {
    const { jobType, orderId, tokenIn, tokenOut, amountIn } = job.data;

    console.log(`[Orca Worker] Processing ${jobType} for order ${orderId}`);

    try {
      if (jobType === 'quote') {
        // ==================== QUOTE PROCESSING ====================

        // Progress: 25% - Starting
        await job.updateProgress(25);

        // PHASE 3: Whirlpool-specific messages
        emitStatusUpdate(orderId, 'routing', {
          message: 'Connecting to Orca Whirlpool...',
          dex: 'Orca',
          stage: 'fetching_whirlpool_data',
          progress: 25,
        });

        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);

        // PHASE 3: Concentrated liquidity analysis
        emitStatusUpdate(orderId, 'routing', {
          message: 'Analyzing concentrated liquidity positions...',
          dex: 'Orca',
          stage: 'analyzing_whirlpool',
          progress: 50,
        });

        // Fetch quote from Orca Whirlpool
        const quote = await dexRouter.getOrcaQuote(tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);

        // PHASE 3: Tick range computation
        emitStatusUpdate(orderId, 'routing', {
          message: 'Computing price impact in tick ranges...',
          dex: 'Orca',
          stage: 'computing_ticks',
          progress: 75,
        });

        await sleep(delay / 2);
        await job.updateProgress(100);

        console.log(`[Orca Worker] ✅ Quote completed: ${quote.estimatedOutput} ${tokenOut}`);

        // Emit quote completion event for coordination
        emitQuoteCompletion(orderId, 'Orca', quote);

        return quote;
      } else if (jobType === 'swap') {
        // ==================== SWAP PROCESSING ====================

        // Progress: 25% - Starting swap
        await job.updateProgress(25);

        // PHASE 3: Transaction building
        emitStatusUpdate(orderId, 'building', {
          message: 'Building Orca Whirlpool transaction...',
          dex: 'Orca',
          stage: 'creating_transaction',
          progress: 25,
        });

        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);

        // PHASE 3: Transaction signing
        emitStatusUpdate(orderId, 'building', {
          message: 'Preparing transaction for signing...',
          dex: 'Orca',
          stage: 'preparing_signature',
          progress: 50,
        });

        // Execute swap on Orca
        const result = await dexRouter.executeSwapOnDex('orca', tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);

        // PHASE 3: Transaction submission
        emitStatusUpdate(orderId, 'submitted', {
          message: 'Transaction submitted to Solana network...',
          dex: 'Orca',
          stage: 'awaiting_confirmation',
          txHash: result.txHash,
          progress: 75,
        });

        await sleep(delay / 2);
        await job.updateProgress(100);

        console.log(`[Orca Worker] ✅ Swap completed: ${result.txHash}`);

        // PHASE 3: Final confirmation with full details
        emitStatusUpdate(orderId, 'confirmed', {
          message: 'Transaction confirmed on-chain',
          dex: 'Orca',
          txHash: result.txHash,
          amountOut: result.amountOut,
          executedPrice: result.executedPrice,
          stage: 'completed',
          progress: 100,
          explorerUrl: `https://solscan.io/tx/${result.txHash}`,
        });

        return result;
      }
    } catch (error: any) {
      console.error(`[Orca Worker] ❌ Error:`, error.message);

      // Emit failure event
      if (jobType === 'quote') {
        emitQuoteFailure(orderId, 'Orca', error.message);
      } else {
        emitStatusUpdate(orderId, 'failed', {
          message: `Orca swap failed: ${error.message}`,
          dex: 'Orca',
          error: error.message,
        });
      }

      throw error;
    }
  }, {
    connection,
    concurrency: 5, // Process up to 5 jobs simultaneously
    limiter: {
      max: 10, // Maximum 10 jobs
      duration: 1000, // per 1 second
    },
  });

  // Setup event handlers for worker lifecycle
  worker.on('completed', (job: Job) => {
    console.log(`[Orca Worker] ✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[Orca Worker] ❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error(`[Orca Worker] ⚠️  Worker error:`, err);
  });

  console.log('[Orca Worker] ✅ Started and listening for jobs');

  return worker;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Emit status update via Node.js EventEmitter (Ani's pattern)
 * Server listens to these events and broadcasts via WebSocket
 */
function emitStatusUpdate(orderId: string, status: string, data: Record<string, any>): void {
  const statusUpdate: OrderStatusUpdate = {
    orderId,
    status,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Emit event that main process can listen to
  setImmediate(() => {
    (process as any).emit('orderStatusUpdate', statusUpdate);
  });
}

/**
 * Emit quote completion event
 * Used by hub to collect quotes from all workers
 */
function emitQuoteCompletion(orderId: string, dex: string, quote: any): void {
  setImmediate(() => {
    (process as any).emit('quoteCompleted', {
      orderId,
      dex,
      quote,
      timestamp: new Date().toISOString(),
    });
  });
  console.log(`[Orca Worker] 📤 Emitted quote completion for order ${orderId}`);
}

/**
 * Emit quote failure event
 */
function emitQuoteFailure(orderId: string, dex: string, error: string): void {
  setImmediate(() => {
    (process as any).emit('quoteFailed', {
      orderId,
      dex,
      error,
      timestamp: new Date().toISOString(),
    });
  });
  console.log(`[Orca Worker] ⚠️  Emitted quote failure for order ${orderId}`);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
