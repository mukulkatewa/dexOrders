/**
 * Jupiter Worker - Handles quote fetching and swap execution for Jupiter DEX
 * Based on Ani's worker.js pattern with process.emit() for status updates
 * 
 * Key Features:
 * - Processes jobs from 'Jupiter-dex' queue
 * - Emits status updates via process.emit() events
 * - Realistic delays (2-5 seconds) for network simulation
 * - Progress tracking with job.updateProgress()
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
 * Create Jupiter Worker
 * Processes quote and swap jobs for Jupiter DEX
 */
export function createJupiterWorker(connection: IORedis): Worker {
  const dexRouter = new MockDexRouter();
  
  const worker = new Worker<DexJobData>('jupiter-dex', async (job: Job<DexJobData>) => {
    const { jobType, orderId, tokenIn, tokenOut, amountIn } = job.data;
    
    console.log(`[Jupiter Worker] Processing ${jobType} for order ${orderId}`);
    
    try {
      if (jobType === 'quote') {
        // ==================== QUOTE PROCESSING ====================
        
        // Progress: 25% - Starting
        await job.updateProgress(25);
        
        // Emit status update with stage details (Ani's pattern)
        emitStatusUpdate(orderId, 'routing', {
          message: 'Fetching Jupiter liquidity data...',
          dex: 'Jupiter',
          stage: 'fetching_data'
        });
        
        // Simulate realistic network delay (2-5 seconds)
        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);
        
        // Fetch quote from Jupiter
        const quote = await dexRouter.getJupiterQuote(tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);
        
        await sleep(delay / 2);
        await job.updateProgress(100);
        
        console.log(`[Jupiter Worker] ✅ Quote completed: ${quote.estimatedOutput} ${tokenOut}`);
        
        // Emit quote completion event for coordination
        emitQuoteCompletion(orderId, 'Jupiter', quote);
        
        return quote;
        
      } else if (jobType === 'swap') {
        // ==================== SWAP PROCESSING ====================
        
        // Progress: 25% - Starting swap
        await job.updateProgress(25);
        
        emitStatusUpdate(orderId, 'building', {
          message: 'Creating Jupiter AMM transaction...',
          dex: 'Jupiter',
          stage: 'creating_transaction'
        });
        
        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);
        
        // Execute swap on Jupiter
        const result = await dexRouter.executeSwapOnDex('Jupiter', tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);
        
        await sleep(delay / 2);
        await job.updateProgress(100);
        
        console.log(`[Jupiter Worker] ✅ Swap completed: ${result.txHash}`);
        
        emitStatusUpdate(orderId, 'confirmed', {
          message: 'Transaction confirmed on Jupiter',
          dex: 'Jupiter',
          txHash: result.txHash,
          amountOut: result.amountOut,
          executedPrice: result.executedPrice
        });
        
        return result;
      }
    } catch (error: any) {
      console.error(`[Jupiter Worker] ❌ Error:`, error.message);
      
      // Emit failure event
      if (jobType === 'quote') {
        emitQuoteFailure(orderId, 'Jupiter', error.message);
      } else {
        emitStatusUpdate(orderId, 'failed', {
          message: `Jupiter swap failed: ${error.message}`,
          dex: 'Jupiter',
          error: error.message
        });
      }
      
      throw error;
    }
  }, {
    connection,
    concurrency: 5, // Process up to 5 jobs simultaneously
    limiter: {
      max: 10, // Maximum 10 jobs
      duration: 1000 // per 1 second
    }
  });

  // Setup event handlers for worker lifecycle
  worker.on('completed', (job: Job) => {
    console.log(`[Jupiter Worker] ✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[Jupiter Worker] ❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error(`[Jupiter Worker] ⚠️  Worker error:`, err);
  });

  console.log('[Jupiter Worker] ✅ Started and listening for jobs');
  
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
    ...data
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
      timestamp: new Date().toISOString()
    });
  });
  console.log(`[Jupiter Worker] 📤 Emitted quote completion for order ${orderId}`);
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
      timestamp: new Date().toISOString()
    });
  });
  console.log(`[Jupiter Worker] ⚠️  Emitted quote failure for order ${orderId}`);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
