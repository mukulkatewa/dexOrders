// src/workers/dexWorker.ts
// PHASE 2: Added individual DEX methods and quote completion events

import { Worker, Job } from 'bullmq';
import { MockDexRouter } from '../services/mockDexRouter';
import { OrderRepository } from '../repositories/orderRepository';
import { RedisService } from '../services/redisService';
import { Order, RoutingStrategy } from '../types';
import IORedis from 'ioredis';

/**
 * Job data structure for DEX workers
 * Each job represents either a quote fetch or a swap execution
 */
interface OrderStatusUpdate {
  orderId: string;
  status: string;
  timestamp: string;
  [key: string]: any; // Allow additional properties
}

interface DexJobData {
  jobType: 'quote' | 'swap';
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  dex: 'raydium' | 'meteora' | 'orca' | 'jupiter'; // Specific DEX this worker handles
  strategy?: RoutingStrategy;
  wallet?: string; // For swap jobs
}

/**
 * DexWorker processes jobs for a specific DEX
 * Based on Ani's pattern: One worker per DEX for parallel processing
 * 
 * PHASE 2 Updates:
 * - Uses individual DEX quote methods (getRaydiumQuote, etc.)
 * - Emits quote completion/failure events for JobScheduler
 * - Better error handling and progress tracking
 */
export class DexWorker {
  private worker: Worker<DexJobData>;
  private dexRouter: MockDexRouter;
  private orderRepository: OrderRepository;
  private redisService: RedisService;
  private dexName: string;

  constructor(
    dexName: 'raydium' | 'meteora' | 'orca' | 'jupiter',
    orderRepository: OrderRepository,
    redisService: RedisService,
    connection: IORedis
  ) {
    this.dexName = dexName;
    this.orderRepository = orderRepository;
    this.redisService = redisService;
    this.dexRouter = new MockDexRouter();

    // Create a worker for this specific DEX's queue
    // Queue name pattern: "raydium-dex", "meteora-dex", etc.
    this.worker = new Worker<DexJobData>(
      `${dexName}-dex`,
      async (job: Job<DexJobData>) => {
        return await this.processJob(job);
      },
      {
        connection,
        concurrency: 5, // Process up to 5 jobs simultaneously per DEX
        limiter: {
          max: 10, // Maximum 10 jobs
          duration: 1000, // per 1 second
        },
      }
    );

    this.setupEventHandlers();
  }

  /**
   * Main job processing logic
   * Routes to quote or swap based on jobType
   */
  private async processJob(job: Job<DexJobData>): Promise<any> {
    const { jobType, orderId } = job.data;

    console.log(`[${this.dexName}Worker] Processing ${jobType} job for order ${orderId}`);

    try {
      if (jobType === 'quote') {
        return await this.processQuoteJob(job);
      } else if (jobType === 'swap') {
        return await this.processSwapJob(job);
      }
    } catch (error: any) {
      console.error(`[${this.dexName}Worker] Job failed:`, error.message);
      
      // Emit failure event
      this.emitStatusUpdate(orderId, 'error', {
        dex: this.dexName,
        error: error.message,
      });

      throw error; // BullMQ will handle retries
    }
  }

  /**
   * PHASE 2: Process a quote-fetching job
   * Now uses DEX-specific methods for targeted quote fetching
   */
  private async processQuoteJob(job: Job<DexJobData>): Promise<any> {
    const { orderId, tokenIn, tokenOut, amountIn } = job.data;

    await job.updateProgress(10);

    // Emit status update via process events (Ani's pattern)
    this.emitStatusUpdate(orderId, 'routing', {
      message: `Fetching quote from ${this.dexName}`,
      dex: this.dexName,
    });

    await job.updateProgress(50);

    try {
      // PHASE 2: Call DEX-specific method for parallel processing
      let quote: any;
      
      switch (this.dexName) {
        case 'raydium':
          quote = await this.dexRouter.getRaydiumQuote(tokenIn, tokenOut, amountIn);
          break;
        case 'meteora':
          quote = await this.dexRouter.getMeteorQuote(tokenIn, tokenOut, amountIn);
          break;
        case 'orca':
          quote = await this.dexRouter.getOrcaQuote(tokenIn, tokenOut, amountIn);
          break;
        case 'jupiter':
          quote = await this.dexRouter.getJupiterQuote(tokenIn, tokenOut, amountIn);
          break;
        default:
          throw new Error(`Unknown DEX: ${this.dexName}`);
      }

      await job.updateProgress(100);

      console.log(`[${this.dexName}Worker] Quote fetched:`, {
        dex: quote.dex,
        price: quote.price,
        output: quote.estimatedOutput,
      });

      // PHASE 2: Emit quote completion event (for JobScheduler)
      this.emitQuoteCompletion(orderId, quote);

      return quote;
    } catch (error: any) {
      console.error(`[${this.dexName}Worker] Quote failed:`, error.message);
      
      // PHASE 2: Emit quote failure event (for JobScheduler)
      this.emitQuoteFailure(orderId, error.message);
      
      throw error;
    }
  }

  /**
   * Process a swap execution job
   * Executes the actual swap on this DEX
   */
  private async processSwapJob(job: Job<DexJobData>): Promise<any> {
    const { orderId, tokenIn, tokenOut, amountIn } = job.data;

    // Building transaction
    await job.updateProgress(25);
    this.emitStatusUpdate(orderId, 'building', {
      message: `Building transaction on ${this.dexName}`,
      dex: this.dexName,
    });

    // Simulate transaction building delay
    await this.sleep(500);

    // Submitting transaction
    await job.updateProgress(50);
    this.emitStatusUpdate(orderId, 'submitted', {
      message: `Transaction submitted to ${this.dexName}`,
      dex: this.dexName,
    });

    // PHASE 2: Execute swap on specific DEX
    const result = await this.dexRouter.executeSwapOnDex(
      this.dexName,
      tokenIn,
      tokenOut,
      amountIn
    );

    await job.updateProgress(75);

    // Update database with execution results
    await this.orderRepository.updateOrderStatus(orderId, 'confirmed', {
      selectedDex: result.dex,
      amountOut: result.amountOut,
      executedPrice: result.executedPrice,
      txHash: result.txHash,
    });

    // Update Redis cache
    const order = await this.orderRepository.getOrderById(orderId);
    if (order) {
      await this.redisService.updateActiveOrder(order);
    }

    await job.updateProgress(100);

    // Emit success status
    this.emitStatusUpdate(orderId, 'confirmed', {
      dex: result.dex,
      txHash: result.txHash,
      amountOut: result.amountOut,
      executedPrice: result.executedPrice,
    });

    return result;
  }

  /**
   * PHASE 2: Emit quote completion (for JobScheduler)
   * Allows JobScheduler to collect quotes from all workers
   */
  private emitQuoteCompletion(orderId: string, quote: any): void {
    setImmediate(() => {
      (process as any).emit('quoteCompleted', {
        orderId,
        dex: this.dexName,
        quote,
        timestamp: new Date().toISOString(),
      });
    });
    
    console.log(`[${this.dexName}Worker] Emitted quote completion for order ${orderId}`);
  }

  /**
   * PHASE 2: Emit quote failure (for JobScheduler)
   * Allows JobScheduler to track failures and proceed with available quotes
   */
  private emitQuoteFailure(orderId: string, error: string): void {
    setImmediate(() => {
      (process as any).emit('quoteFailed', {
        orderId,
        dex: this.dexName,
        error,
        timestamp: new Date().toISOString(),
      });
    });
    
    console.log(`[${this.dexName}Worker] Emitted quote failure for order ${orderId}`);
  }

  /**
   * Emit status updates via process events
   * This is Ani's key pattern: Workers emit events, main process broadcasts to WebSocket
   */
  private emitStatusUpdate(
    orderId: string,
    status: string,
    data: Record<string, any> = {}
  ): void {
    const update: OrderStatusUpdate = {
      orderId,
      status,
      timestamp: new Date().toISOString(),
      ...data,
    };

    // Emit to main process
    setImmediate(() => {
      (process as any).emit('orderStatusUpdate', update);
    });
    
    console.log(`[${this.dexName}Worker] Emitted status:`, update);
  }

  /**
   * Setup event handlers for worker lifecycle
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job) => {
      console.log(`[${this.dexName}Worker] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      console.error(`[${this.dexName}Worker] Job ${job?.id} failed:`, err.message);
    });

    this.worker.on('error', (err: Error) => {
      console.error(`[${this.dexName}Worker] Worker error:`, err);
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`[${this.dexName}Worker] Job ${jobId} stalled`);
    });
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    await this.worker.close();
    console.log(`[${this.dexName}Worker] Worker closed`);
  }

  /**
   * Utility: Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get worker instance (for testing)
   */
  getWorker(): Worker<DexJobData> {
    return this.worker;
  }
}
