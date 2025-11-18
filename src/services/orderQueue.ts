// src/services/orderQueue.ts
// PHASE 2: Enhanced with better orchestration for parallel quote processing

import { Queue } from 'bullmq';
import { Order, RoutingStrategy } from '../types';
import IORedis from 'ioredis';

/**
 * OrderQueue manages multiple DEX queues for parallel processing
 * PHASE 2: Simplified to focus on orchestration
 * - JobScheduler handles parallel quote coordination
 * - Workers handle actual execution
 */
export class OrderQueue {
  // Map to hold individual DEX queues
  private dexQueues: Map<string, Queue>;
  private webSockets: Map<string, any> = new Map();
  private connection: IORedis;

  constructor() {
    // Create Redis connection for BullMQ
    this.connection = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null, // Required for BullMQ
      tls: process.env.REDIS_HOST?.includes('upstash') 
        ? { rejectUnauthorized: false } 
        : undefined,
    });

    // Initialize separate queues for each DEX
    this.dexQueues = new Map();
    const dexNames = ['raydium', 'meteora', 'orca', 'jupiter'];
    
    for (const dex of dexNames) {
      const queue = new Queue(`${dex}-dex`, { connection: this.connection });
      this.dexQueues.set(dex, queue);
      console.log(`[OrderQueue] Created queue for ${dex}`);
    }
  }

  /**
   * Register WebSocket for an order
   */
  registerWebSocket(orderId: string, ws: any): void {
    this.webSockets.set(orderId, ws);
    console.log(`[OrderQueue] WebSocket registered for order ${orderId}`);
  }

  /**
   * Unregister WebSocket
   */
  unregisterWebSocket(orderId: string): void {
    this.webSockets.delete(orderId);
    console.log(`[OrderQueue] WebSocket unregistered for order ${orderId}`);
  }

  /**
   * Get WebSocket for an order (used by event bridge)
   */
  getWebSocket(orderId: string): any {
    return this.webSockets.get(orderId);
  }

  /**
   * PHASE 2: Add a quote job to a specific DEX queue
   * This allows parallel quote fetching across all DEXs
   */
  async addQuoteJob(
    dex: 'raydium' | 'meteora' | 'orca' | 'jupiter',
    orderId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    strategy: RoutingStrategy
  ): Promise<string> {
    const queue = this.dexQueues.get(dex);
    if (!queue) {
      throw new Error(`Queue for DEX ${dex} not found`);
    }

    const job = await queue.add('quote', {
      jobType: 'quote',
      orderId,
      tokenIn,
      tokenOut,
      amountIn,
      dex,
      strategy,
    });

    console.log(`[OrderQueue] Added quote job ${job.id} to ${dex} queue`);
    return job.id!;
  }

  /**
   * PHASE 2: Add swap job to a specific DEX queue
   * Called after routing hub selects best DEX
   */
  async addSwapJob(
    dex: 'raydium' | 'meteora' | 'orca' | 'jupiter',
    orderId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    wallet?: string
  ): Promise<string> {
    const queue = this.dexQueues.get(dex);
    if (!queue) {
      throw new Error(`Queue for DEX ${dex} not found`);
    }

    const job = await queue.add('swap', {
      jobType: 'swap',
      orderId,
      tokenIn,
      tokenOut,
      amountIn,
      dex,
      wallet,
    });

    console.log(`[OrderQueue] Added swap job ${job.id} to ${dex} queue`);
    return job.id!;
  }

  /**
   * PHASE 2: Add order for processing
   * Entry point called by WebSocket handler
   * JobScheduler will handle parallel quote coordination
   */
  async addOrder(order: Order, strategy: RoutingStrategy = 'BEST_PRICE'): Promise<void> {
    console.log(`[OrderQueue] Order ${order.id} received with strategy ${strategy}`);
    
    // Note: Parallel quote processing is triggered by JobScheduler
    // This method is kept for API compatibility
    // The actual parallel jobs are launched by JobScheduler.addCompareQuotesJob()
  }

  /**
   * Get specific queue by DEX name (for advanced use)
   */
  getQueue(dex: string): Queue | undefined {
    return this.dexQueues.get(dex);
  }

  /**
   * Get all queue names
   */
  getQueueNames(): string[] {
    return Array.from(this.dexQueues.keys());
  }

  /**
   * Check queue health
   */
  async getQueueHealth(): Promise<Record<string, any>> {
    const health: Record<string, any> = {};
    
    for (const [dex, queue] of this.dexQueues) {
      try {
        const jobCounts = await queue.getJobCounts();
        health[dex] = {
          status: 'healthy',
          ...jobCounts,
        };
      } catch (error: any) {
        health[dex] = {
          status: 'unhealthy',
          error: error.message,
        };
      }
    }
    
    return health;
  }

  /**
   * Get Redis connection (for workers)
   */
  getConnection(): IORedis {
    return this.connection;
  }

  /**
   * Close all queues and connection
   */
  async close(): Promise<void> {
    console.log('[OrderQueue] Closing all queues...');
    
    for (const [dex, queue] of this.dexQueues) {
      try {
        await queue.close();
        console.log(`[OrderQueue] ✓ Closed queue for ${dex}`);
      } catch (error: any) {
        console.error(`[OrderQueue] ✗ Failed to close ${dex} queue:`, error.message);
      }
    }
    
    try {
      await this.connection.quit();
      console.log('[OrderQueue] ✓ Redis connection closed');
    } catch (error: any) {
      console.error('[OrderQueue] ✗ Failed to close Redis:', error.message);
    }
  }

  /**
   * PHASE 2: Clean up stale jobs (optional maintenance)
   */
  async cleanupStaleJobs(olderThanMs: number = 3600000): Promise<void> {
    console.log(`[OrderQueue] Cleaning up jobs older than ${olderThanMs}ms...`);
    
    for (const [dex, queue] of this.dexQueues) {
      try {
        const cleaned = await queue.clean(olderThanMs, 100, 'completed');
        console.log(`[OrderQueue] Cleaned ${cleaned.length} completed jobs from ${dex}`);
      } catch (error: any) {
        console.error(`[OrderQueue] Failed to clean ${dex} queue:`, error.message);
      }
    }
  }
}
