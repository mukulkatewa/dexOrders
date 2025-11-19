/**
 * Orca Worker - Handles quote fetching and swap execution for Orca DEX
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

export function createOrcaWorker(connection: IORedis): Worker {
  const dexRouter = new MockDexRouter();
  
  const worker = new Worker<DexJobData>('orca-dex', async (job: Job<DexJobData>) => {
    const { jobType, orderId, tokenIn, tokenOut, amountIn } = job.data;
    
    console.log(`[Orca Worker] Processing ${jobType} for order ${orderId}`);
    
    try {
      if (jobType === 'quote') {
        await job.updateProgress(25);
        
        emitStatusUpdate(orderId, 'routing', {
          message: 'Fetching Orca Whirlpool data...',
          dex: 'Orca',
          stage: 'analyzing_whirlpool'
        });
        
        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);
        
        const quote = await dexRouter.getOrcaQuote(tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);
        
        await sleep(delay / 2);
        await job.updateProgress(100);
        
        console.log(`[Orca Worker] ✅ Quote completed: ${quote.estimatedOutput} ${tokenOut}`);
        
        emitQuoteCompletion(orderId, 'Orca', quote);
        
        return quote;
        
      } else if (jobType === 'swap') {
        await job.updateProgress(25);
        
        emitStatusUpdate(orderId, 'building', {
          message: 'Creating Orca Whirlpool transaction...',
          dex: 'Orca',
          stage: 'creating_transaction'
        });
        
        const delay = 2000 + Math.random() * 3000;
        await sleep(delay / 2);
        await job.updateProgress(50);
        
        const result = await dexRouter.executeSwapOnDex('orca', tokenIn, tokenOut, amountIn);
        await job.updateProgress(75);
        
        await sleep(delay / 2);
        await job.updateProgress(100);
        
        console.log(`[Orca Worker] ✅ Swap completed: ${result.txHash}`);
        
        emitStatusUpdate(orderId, 'confirmed', {
          message: 'Transaction confirmed on Orca',
          dex: 'Orca',
          txHash: result.txHash,
          amountOut: result.amountOut,
          executedPrice: result.executedPrice
        });
        
        return result;
      }
    } catch (error: any) {
      console.error(`[Orca Worker] ❌ Error:`, error.message);
      
      if (jobType === 'quote') {
        emitQuoteFailure(orderId, 'Orca', error.message);
      } else {
        emitStatusUpdate(orderId, 'failed', {
          message: `Orca swap failed: ${error.message}`,
          dex: 'Orca',
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
  console.log(`[Orca Worker] 📤 Emitted quote completion for order ${orderId}`);
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
  console.log(`[Orca Worker] ⚠️  Emitted quote failure for order ${orderId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
