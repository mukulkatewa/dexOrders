/**
 * Meteora Worker - Handles quote fetching and swap execution for Meteora DEX
 * Based on Ani's worker.js pattern
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { MockDexRouter } from '../services/mockDexRouter';

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

interface OrderStatusUpdate {
  orderId: string;
  status: string;
  timestamp: string;
  [key: string]: any;
}

export function createMeteoraWorker(connection: IORedis): Worker {
  const dexRouter = new MockDexRouter();
  
  const worker = new Worker<DexJobData>('meteora-dex', async (job: Job<DexJobData>) => {
    const { jobType, orderId, tokenIn, tokenOut, amountIn } = job.data;
    
    console.log(`[Meteora Worker] Processing ${jobType} for order ${orderId}`);
    
    try {
      if (jobType === 'quote') {
        await job.updateProgress(25);
        
        emitStatusUpdate(orderId, 'routing', {
          message: 'Fetching Meteora DLMM data...',
          dex: 'Meteora',
          stage: 'analyzing_dlmm'
        });
        
        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);
        
        const quote = await dexRouter.getMeteoraQuote(tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);
        
        await sleep(delay / 2);
        await job.updateProgress(100);
        
        console.log(`[Meteora Worker] ✅ Quote completed: ${quote.estimatedOutput} ${tokenOut}`);
        
        emitQuoteCompletion(orderId, 'Meteora', quote);
        
        return quote;
        
      } else if (jobType === 'swap') {
        await job.updateProgress(25);
        
        emitStatusUpdate(orderId, 'building', {
          message: 'Creating Meteora DLMM transaction...',
          dex: 'Meteora',
          stage: 'optimizing_bins'
        });
        
        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);
        
        const result = await dexRouter.executeSwapOnDex('meteora', tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);
        
        await sleep(delay / 2);
        await job.updateProgress(100);
        
        console.log(`[Meteora Worker] ✅ Swap completed: ${result.txHash}`);
        
        emitStatusUpdate(orderId, 'confirmed', {
          message: 'Transaction confirmed on Meteora',
          dex: 'Meteora',
          txHash: result.txHash,
          amountOut: result.amountOut,
          executedPrice: result.executedPrice
        });
        
        return result;
      }
    } catch (error: any) {
      console.error(`[Meteora Worker] ❌ Error:`, error.message);
      
      if (jobType === 'quote') {
        emitQuoteFailure(orderId, 'Meteora', error.message);
      } else {
        emitStatusUpdate(orderId, 'failed', {
          message: `Meteora swap failed: ${error.message}`,
          dex: 'Meteora',
          error: error.message
        });
      }
      
      throw error;
    }
  }, {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000
    }
  });

  worker.on('completed', (job: Job) => {
    console.log(`[Meteora Worker] ✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[Meteora Worker] ❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error(`[Meteora Worker] ⚠️  Worker error:`, err);
  });

  console.log('[Meteora Worker] ✅ Started and listening for jobs');
  
  return worker;
}

function emitStatusUpdate(orderId: string, status: string, data: Record<string, any>): void {
  const statusUpdate: OrderStatusUpdate = {
    orderId,
    status,
    timestamp: new Date().toISOString(),
    ...data
  };
  
  setImmediate(() => {
    (process as any).emit('orderStatusUpdate', statusUpdate);
  });
}

function emitQuoteCompletion(orderId: string, dex: string, quote: any): void {
  setImmediate(() => {
    (process as any).emit('quoteCompleted', {
      orderId,
      dex,
      quote,
      timestamp: new Date().toISOString()
    });
  });
  console.log(`[Meteora Worker] 📤 Emitted quote completion for order ${orderId}`);
}

function emitQuoteFailure(orderId: string, dex: string, error: string): void {
  setImmediate(() => {
    (process as any).emit('quoteFailed', {
      orderId,
      dex,
      error,
      timestamp: new Date().toISOString()
    });
  });
  console.log(`[Meteora Worker] ⚠️  Emitted quote failure for order ${orderId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
