/**
 * OrderQueue - Manages 4 separate DEX queues for parallel processing
 * Based on Ani's queue.js pattern with separate queues per DEX
 *
 * Architecture:
 * - 4 independent queues: raydium-dex, meteora-dex, orca-dex, jupiter-dex
 * - Each queue handles quote and swap jobs for its specific DEX
 * - Enables true parallel quote fetching across all DEXs
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { Order, RoutingStrategy } from "../types";

export class OrderQueue {
  // Separate queue for each DEX (Ani's pattern)
  private raydiumQueue: Queue;
  private meteoraQueue: Queue;
  private orcaQueue: Queue;
  private jupiterQueue: Queue;

  // Shared Redis connection
  private connection: IORedis;

  // Track WebSocket connections per order
  private webSockets: Map<string, any> = new Map();

  constructor() {
    console.log("[OrderQueue] Initializing with 4 separate DEX queues...");

    // Create shared Redis connection
    this.connection = new IORedis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null, // Required for BullMQ
      tls: process.env.REDIS_HOST?.includes("upstash")
        ? { rejectUnauthorized: false }
        : undefined,
    });

    // Shared limiter configuration (10 jobs/sec ≈ 600 jobs/min across 4 queues)
    const queueOptions = {
      connection: this.connection,
      limiter: {
        max: 10, // Up to 10 jobs
        duration: 1000, // Per 1000ms (1 second)
      },
    };

    // Initialize separate queues for each DEX with concurrency limiter
    this.raydiumQueue = new Queue("raydium-dex", queueOptions);
    this.meteoraQueue = new Queue("meteora-dex", queueOptions);
    this.orcaQueue = new Queue("orca-dex", queueOptions);
    this.jupiterQueue = new Queue("jupiter-dex", queueOptions);

    console.log(
      "[OrderQueue] ✅ Created 4 DEX queues: raydium, meteora, orca, jupiter"
    );
  }

  /**
   * Add a quote job to a specific DEX queue
   * This enables parallel quote fetching
   *
   * @param dex - DEX name (raydium, meteora, orca, jupiter)
   * @param orderId - Order identifier
   * @param tokenIn - Input token symbol
   * @param tokenOut - Output token symbol
   * @param amountIn - Input amount
   * @param strategy - Routing strategy
   */
  async addQuoteJob(
    dex: "raydium" | "meteora" | "orca" | "jupiter",
    orderId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    strategy: RoutingStrategy
  ): Promise<string> {
    const queueMap = {
      raydium: this.raydiumQueue,
      meteora: this.meteoraQueue,
      orca: this.orcaQueue,
      jupiter: this.jupiterQueue,
    };

    const queue = queueMap[dex];
    console.log(
      `[OrderQueue] Adding quote job to ${dex} queue for order ${orderId}`
    );


    //add job with retry logic
    const job = await queue.add(
      "quote",
      {
        jobType: "quote",
        orderId,
        tokenIn,
        tokenOut,
        amountIn,
        dex,
        strategy,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: 10,
        removeOnFail: 5,
      }
    );

    return job.id!;
  }

  /**
   * Add a swap job to a specific DEX queue
   * Called after routing hub selects the best DEX
   *
   * @param dex - Selected DEX name
   * @param orderId - Order identifier
   * @param tokenIn - Input token symbol
   * @param tokenOut - Output token symbol
   * @param amountIn - Input amount
   * @param wallet - Wallet address (optional)
   */
  async addSwapJob(
    dex: "raydium" | "meteora" | "orca" | "jupiter",
    orderId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    wallet?: string
  ): Promise<string> {
    const queueMap = {
      raydium: this.raydiumQueue,
      meteora: this.meteoraQueue,
      orca: this.orcaQueue,
      jupiter: this.jupiterQueue,
    };

    const queue = queueMap[dex];
    console.log(
      `[OrderQueue] Adding swap job to ${dex} queue for order ${orderId}`
    );

    const job = await queue.add(
      "swap",
      {
        jobType: "swap",
        orderId,
        tokenIn,
        tokenOut,
        amountIn,
        dex,
        wallet,
      },
      {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 10000,
        },
        removeOnComplete: 10,
        removeOnFail: 10,
      }
    );

    return job.id!;
  }

  /**
   * Add quote jobs for all DEXs in parallel 
   * This is the key improvement: 4 workers fetch quotes simultaneously
   *
   * @param order - Order details
   * @param strategy - Routing strategy to apply
   * @returns Array of job IDs
   */
  async addCompareQuotesJob(
    order: Order,
    strategy: RoutingStrategy = "BEST_PRICE"
  ): Promise<string[]> {
    console.log(
      `[OrderQueue] Launching parallel quote collection for order ${order.id} with strategy ${strategy}`
    );

    setImmediate(() => {
      (process as any).emit("orderStrategySet", {
        orderId: order.id,
        strategy: strategy,
      });
    });

    try {
      // Launch all 4 quote jobs simultaneously using Promise.all
      const jobIds = await Promise.all([
        this.addQuoteJob(
          "raydium",
          order.id,
          order.tokenIn,
          order.tokenOut,
          order.amountIn,
          strategy
        ),
        this.addQuoteJob(
          "meteora",
          order.id,
          order.tokenIn,
          order.tokenOut,
          order.amountIn,
          strategy
        ),
        this.addQuoteJob(
          "orca",
          order.id,
          order.tokenIn,
          order.tokenOut,
          order.amountIn,
          strategy
        ),
        this.addQuoteJob(
          "jupiter",
          order.id,
          order.tokenIn,
          order.tokenOut,
          order.amountIn,
          strategy
        ),
      ]);

      console.log(
        `[OrderQueue] ✅ Launched ${jobIds.length} parallel quote jobs for order ${order.id}`
      );
      return jobIds;
    } catch (error) {
      console.error(
        `[OrderQueue] ❌ Failed to launch parallel jobs for order ${order.id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Register WebSocket for an order
   * Used to broadcast status updates to the client
   */
  registerWebSocket(orderId: string, ws: any): void {
    this.webSockets.set(orderId, ws);
    console.log(`[OrderQueue] WebSocket registered for order ${orderId}`);
  }

  /**
   * Unregister WebSocket for an order
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
   * Get Redis connection for workers to use
   */
  getConnection(): IORedis {
    return this.connection;
  }

  /**
   * Get specific queue by DEX name (for advanced use)
   */
  getQueue(dex: string): Queue | undefined {
    const queueMap: Record<string, Queue> = {
      raydium: this.raydiumQueue,
      meteora: this.meteoraQueue,
      orca: this.orcaQueue,
      jupiter: this.jupiterQueue,
    };
    return queueMap[dex];
  }

  /**
   * Get all queue names
   */
  getQueueNames(): string[] {
    return ["raydium", "meteora", "orca", "jupiter"];
  }

  /**
   * Get queue health status for all DEXs
   */
  async getQueueHealth(): Promise<Record<string, any>> {
    const health: Record<string, any> = {};
    const queues = {
      raydium: this.raydiumQueue,
      meteora: this.meteoraQueue,
      orca: this.orcaQueue,
      jupiter: this.jupiterQueue,
    };

    for (const [dex, queue] of Object.entries(queues)) {
      try {
        const jobCounts = await queue.getJobCounts();
        health[dex] = {
          status: "healthy",
          ...jobCounts,
        };
      } catch (error: any) {
        health[dex] = {
          status: "unhealthy",
          error: error.message,
        };
      }
    }

    return health;
  }

  /**
   * Close all queues and Redis connection
   */
  async close(): Promise<void> {
    console.log("[OrderQueue] Closing all queues...");

    const queues = [
      { name: "raydium", queue: this.raydiumQueue },
      { name: "meteora", queue: this.meteoraQueue },
      { name: "orca", queue: this.orcaQueue },
      { name: "jupiter", queue: this.jupiterQueue },
    ];

    for (const { name, queue } of queues) {
      try {
        await queue.close();
        console.log(`[OrderQueue] ✅ Closed ${name} queue`);
      } catch (error: any) {
        console.error(
          `[OrderQueue] ❌ Failed to close ${name} queue:`,
          error.message
        );
      }
    }

    try {
      await this.connection.quit();
      console.log("[OrderQueue] ✅ Redis connection closed");
    } catch (error: any) {
      console.error("[OrderQueue] ❌ Failed to close Redis:", error.message);
    }
  }
}
