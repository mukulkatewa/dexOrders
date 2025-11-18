// src/services/jobScheduler.ts
// PHASE 3: Integrated with RoutingHub for intelligent DEX selection
// Enhanced with cumulative statistics tracking

import { OrderQueue } from './orderQueue';
import { RoutingHub } from './routingHub';
import { Order, RoutingStrategy } from '../types';

/**
 * JobScheduler coordinates parallel quote fetching from multiple DEXs
 * Based on Ani's addCompareQuotesJob pattern
 * 
 * PHASE 3 Updates:
 * - Integrated RoutingHub for intelligent DEX selection
 * - Quote validation before processing
 * - Comprehensive market analysis
 * - Strategy-based routing with tuple optimization
 * - Cumulative statistics tracking
 */
export class JobScheduler {
  private orderQueue: OrderQueue;
  private routingHub: RoutingHub;

  // Track quote collection progress
  private orderQuotes: Map<string, {
    quotes: any[];
    expectedQuotes: number;
    receivedQuotes: number;
    startTime: Date;
    strategy?: RoutingStrategy;
  }> = new Map();

  // Timeout tracking for quote collection
  private quoteTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // PHASE 3: Cumulative statistics
  private stats = {
    totalOrdersProcessed: 0,
    totalQuotesCollected: 0,
    totalQuotesFailed: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalQuoteTimeMs: 0, // For average calculation
    quotesByDex: {
      raydium: { success: 0, failed: 0 },
      meteora: { success: 0, failed: 0 },
      orca: { success: 0, failed: 0 },
      jupiter: { success: 0, failed: 0 },
    },
    strategyUsage: {
      BEST_PRICE: 0,
      LOWEST_SLIPPAGE: 0,
      HIGHEST_LIQUIDITY: 0,
      FASTEST_EXECUTION: 0,
    },
  };

  constructor(orderQueue: OrderQueue) {
    this.orderQueue = orderQueue;
    this.routingHub = new RoutingHub();
    console.log('[JobScheduler] Initialized with RoutingHub for intelligent routing');
  }

  /**
   * Add quote jobs for all DEXs in parallel (Ani's pattern)
   * This is the key improvement: 4 workers fetch quotes simultaneously
   */
  async addCompareQuotesJob(
    order: Order,
    strategy: RoutingStrategy = 'BEST_PRICE'
  ): Promise<string[]> {
    console.log(`[JobScheduler] Starting parallel quote collection for order ${order.id} with strategy ${strategy}`);

    // Increment total orders processed
    this.stats.totalOrdersProcessed++;
    
    // Track strategy usage
    this.stats.strategyUsage[strategy]++;

    // Initialize quote tracking with strategy
    this.orderQuotes.set(order.id, {
      quotes: [],
      expectedQuotes: 4, // Raydium, Meteora, Orca, Jupiter
      receivedQuotes: 0,
      startTime: new Date(),
      strategy,
    });

    try {
      // Launch all 4 quote jobs in parallel using Promise.all
      const jobIds = await Promise.all([
        this.orderQueue.addQuoteJob('raydium', order.id, order.tokenIn, order.tokenOut, order.amountIn, strategy),
        this.orderQueue.addQuoteJob('meteora', order.id, order.tokenIn, order.tokenOut, order.amountIn, strategy),
        this.orderQueue.addQuoteJob('orca', order.id, order.tokenIn, order.tokenOut, order.amountIn, strategy),
        this.orderQueue.addQuoteJob('jupiter', order.id, order.tokenIn, order.tokenOut, order.amountIn, strategy),
      ]);

      console.log(`[JobScheduler] Launched ${jobIds.length} parallel quote jobs for order ${order.id}`);

      // Set timeout for quote collection (10 seconds)
      this.setQuoteTimeout(order.id);

      return jobIds;
    } catch (error) {
      console.error(`[JobScheduler] Failed to launch parallel jobs for order ${order.id}:`, error);
      this.orderQuotes.delete(order.id);
      this.stats.failedExecutions++;
      throw error;
    }
  }

  /**
   * Add quote received from a DEX worker
   * Called by event bridge when worker completes
   */
  addQuoteResult(orderId: string, dex: string, quote: any): void {
    const quotesInfo = this.orderQuotes.get(orderId);
    if (!quotesInfo) {
      console.warn(`[JobScheduler] Quote received for unknown order ${orderId}`);
      return;
    }

    // Add provider info to quote
    const quoteWithProvider = { ...quote, provider: dex };
    quotesInfo.quotes.push(quoteWithProvider);
    quotesInfo.receivedQuotes++;

    // Increment successful quote count
    this.stats.totalQuotesCollected++;
    
    // Track per-DEX success
    const dexKey = dex.toLowerCase() as keyof typeof this.stats.quotesByDex;
    if (this.stats.quotesByDex[dexKey]) {
      this.stats.quotesByDex[dexKey].success++;
    }

    console.log(`[JobScheduler] Quote received from ${dex} for order ${orderId} (${quotesInfo.receivedQuotes}/${quotesInfo.expectedQuotes})`);

    // Emit quote received event
    this.emitQuoteUpdate(orderId, dex, quote, quotesInfo.receivedQuotes, quotesInfo.expectedQuotes);

    // Check if we should process quotes now
    this.checkQuoteCompletion(orderId);
  }

  /**
   * Add quote failure from a DEX worker
   */
  addQuoteFailure(orderId: string, dex: string, error: string): void {
    const quotesInfo = this.orderQuotes.get(orderId);
    if (!quotesInfo) {
      console.warn(`[JobScheduler] Quote failure for unknown order ${orderId}`);
      return;
    }

    quotesInfo.receivedQuotes++; // Count as received (but failed)
    
    // Increment failed quote count
    this.stats.totalQuotesFailed++;
    
    // Track per-DEX failure
    const dexKey = dex.toLowerCase() as keyof typeof this.stats.quotesByDex;
    if (this.stats.quotesByDex[dexKey]) {
      this.stats.quotesByDex[dexKey].failed++;
    }

    console.warn(`[JobScheduler] Quote failed from ${dex} for order ${orderId}: ${error}`);

    // Emit failure event
    (process as any).emit('orderStatusUpdate', {
      orderId,
      status: 'quote_failed',
      dex,
      error,
      quotesReceived: quotesInfo.receivedQuotes,
      totalExpected: quotesInfo.expectedQuotes,
      timestamp: new Date().toISOString(),
    });

    // Check if we should process with remaining quotes
    this.checkQuoteCompletion(orderId);
  }

  /**
   * Check if quote collection is complete
   * Processes when: all quotes received OR minimum quotes (2) + timeout
   */
  private checkQuoteCompletion(orderId: string): void {
    const quotesInfo = this.orderQuotes.get(orderId);
    if (!quotesInfo) return;

    const hasAllQuotes = quotesInfo.receivedQuotes >= quotesInfo.expectedQuotes;
    const hasMinimumQuotes = quotesInfo.quotes.length >= 2;
    const hasTimedOut = this.hasQuoteTimedOut(orderId);

    const shouldProcess = hasAllQuotes || (hasMinimumQuotes && hasTimedOut);

    if (shouldProcess) {
      // Calculate quote collection time
      const quoteTime = Date.now() - quotesInfo.startTime.getTime();
      this.stats.totalQuoteTimeMs += quoteTime;

      console.log(`[JobScheduler] Quote collection complete for order ${orderId}:`, {
        received: quotesInfo.receivedQuotes,
        valid: quotesInfo.quotes.length,
        expected: quotesInfo.expectedQuotes,
        timedOut: hasTimedOut,
        strategy: quotesInfo.strategy,
        collectionTimeMs: quoteTime,
      });

      // Clear timeout
      this.clearQuoteTimeout(orderId);

      // Process quotes and select best route
      this.processQuotes(orderId);
    }
  }

  /**
   * PHASE 3: Process collected quotes with RoutingHub
   * Uses intelligent routing to select optimal DEX
   */
  private processQuotes(orderId: string): void {
    const quotesInfo = this.orderQuotes.get(orderId);
    if (!quotesInfo || quotesInfo.quotes.length === 0) {
      console.error(`[JobScheduler] No valid quotes to process for order ${orderId}`);
      
      this.stats.failedExecutions++;
      
      (process as any).emit('orderStatusUpdate', {
        orderId,
        status: 'failed',
        message: 'No valid quotes received from any DEX',
        timestamp: new Date().toISOString(),
      });

      this.orderQuotes.delete(orderId);
      return;
    }

    // PHASE 3: Validate quotes through RoutingHub
    const validation = this.routingHub.validateQuotes(quotesInfo.quotes);
    
    if (!validation.valid) {
      console.error(`[JobScheduler] Quote validation failed for order ${orderId}:`, validation.errors);
      
      this.stats.failedExecutions++;
      
      (process as any).emit('orderStatusUpdate', {
        orderId,
        status: 'failed',
        message: 'Quote validation failed',
        errors: validation.errors,
        timestamp: new Date().toISOString(),
      });

      this.orderQuotes.delete(orderId);
      return;
    }

    // PHASE 3: Emit warnings if any
    if (validation.warnings.length > 0) {
      console.warn(`[JobScheduler] Warnings for order ${orderId}:`, validation.warnings);
      
      (process as any).emit('orderStatusUpdate', {
        orderId,
        status: 'routing_warnings',
        warnings: validation.warnings,
        timestamp: new Date().toISOString(),
      });
    }

    // PHASE 3: Get comprehensive routing analysis
    const analysis = this.routingHub.getRoutingAnalysis(quotesInfo.quotes);
    
    console.log(`[JobScheduler] Routing analysis for order ${orderId}:`, {
      selectedDex: analysis.selectedRoute.provider,
      marketSpread: `${analysis.marketMetrics.priceSpreadPercentage.toFixed(4)}%`,
      totalLiquidity: analysis.marketMetrics.totalLiquidity,
      bestOutput: analysis.marketMetrics.bestOutputAmount,
    });

    // Track successful routing
    this.stats.successfulExecutions++;

    // PHASE 3: Emit quotes collected with full analysis
    (process as any).emit('quotesCollected', {
      orderId,
      quotes: quotesInfo.quotes,
      totalReceived: quotesInfo.receivedQuotes,
      validQuotes: quotesInfo.quotes.length,
      strategy: quotesInfo.strategy || 'BEST_PRICE',
      routingAnalysis: analysis,
      routingHub: this.routingHub,
      timestamp: new Date().toISOString(),
    });

    // Cleanup
    this.orderQuotes.delete(orderId);
  }

  /**
   * Emit quote update event
   */
  private emitQuoteUpdate(
    orderId: string,
    dex: string,
    quote: any,
    received: number,
    expected: number
  ): void {
    (process as any).emit('orderStatusUpdate', {
      orderId,
      status: 'quote_received',
      dex,
      quote: {
        price: quote.price,
        estimatedOutput: quote.estimatedOutput,
        slippage: quote.slippage,
        liquidity: quote.liquidity,
      },
      quotesReceived: received,
      totalExpected: expected,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Set quote collection timeout (10 seconds)
   */
  private setQuoteTimeout(orderId: string): void {
    const timeout = setTimeout(() => {
      console.log(`[JobScheduler] Quote timeout reached for order ${orderId}`);
      this.checkQuoteCompletion(orderId);
    }, 10000); // 10 second timeout

    this.quoteTimeouts.set(orderId, timeout);
  }

  /**
   * Clear quote timeout
   */
  private clearQuoteTimeout(orderId: string): void {
    const timeout = this.quoteTimeouts.get(orderId);
    if (timeout) {
      clearTimeout(timeout);
      this.quoteTimeouts.delete(orderId);
    }
  }

  /**
   * Check if quote collection has timed out
   */
  private hasQuoteTimedOut(orderId: string): boolean {
    const quotesInfo = this.orderQuotes.get(orderId);
    if (!quotesInfo) return false;

    const elapsed = Date.now() - quotesInfo.startTime.getTime();
    return elapsed >= 10000; // 10 seconds
  }

  /**
   * Get quote collection status
   */
  getQuoteStatus(orderId: string): any {
    return this.orderQuotes.get(orderId);
  }

  /**
   * PHASE 3: Get RoutingHub instance (for external access)
   */
  getRoutingHub(): RoutingHub {
    return this.routingHub;
  }

  /**
   * PHASE 3: Get routing strategies available
   */
  getAvailableStrategies(): {
    strategies: RoutingStrategy[];
    default: RoutingStrategy;
    descriptions: Record<RoutingStrategy, string>;
  } {
    return this.routingHub.getAvailableStrategies();
  }

  /**
   * PHASE 3: Validate quotes manually (for testing/debugging)
   */
  validateQuotes(quotes: any[]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    return this.routingHub.validateQuotes(quotes);
  }

  /**
   * PHASE 3: Get routing analysis for quotes (for testing/debugging)
   */
  analyzeQuotes(quotes: any[]): any {
    return this.routingHub.getRoutingAnalysis(quotes);
  }

  /**
   * PHASE 3: Compare two quotes directly
   */
  compareQuotes(quoteA: any, quoteB: any): any {
    return this.routingHub.compareQuotes(quoteA, quoteB);
  }

  /**
   * Get statistics about current quote collection
   * Enhanced with cumulative statistics
   */
  getStatistics(): {
    // Real-time stats
    activeOrders: number;
    pendingTimeouts: number;
    averageQuoteTime: number;
    // Cumulative stats
    totalOrdersProcessed: number;
    totalQuotesCollected: number;
    totalQuotesFailed: number;
    quoteSuccessRate: number;
    successfulExecutions: number;
    failedExecutions: number;
    executionSuccessRate: number;
    averageQuoteCollectionTimeMs: number;
    // Per-DEX statistics
    dexPerformance: {
      raydium: { success: number; failed: number; successRate: number };
      meteora: { success: number; failed: number; successRate: number };
      orca: { success: number; failed: number; successRate: number };
      jupiter: { success: number; failed: number; successRate: number };
    };
    // Strategy usage
    strategyUsage: {
      BEST_PRICE: number;
      LOWEST_SLIPPAGE: number;
      HIGHEST_LIQUIDITY: number;
      FASTEST_EXECUTION: number;
    };
  } {
    const activeOrders = this.orderQuotes.size;
    const pendingTimeouts = this.quoteTimeouts.size;
    
    // Calculate average quote time for active orders
    let totalElapsed = 0;
    for (const quotesInfo of this.orderQuotes.values()) {
      const elapsed = Date.now() - quotesInfo.startTime.getTime();
      totalElapsed += elapsed;
    }
    const averageQuoteTime = activeOrders > 0 ? totalElapsed / activeOrders : 0;

    // Calculate quote success rate
    const totalQuotes = this.stats.totalQuotesCollected + this.stats.totalQuotesFailed;
    const quoteSuccessRate = totalQuotes > 0 
      ? (this.stats.totalQuotesCollected / totalQuotes) * 100 
      : 100;

    // Calculate execution success rate
    const totalExecutions = this.stats.successfulExecutions + this.stats.failedExecutions;
    const executionSuccessRate = totalExecutions > 0
      ? (this.stats.successfulExecutions / totalExecutions) * 100
      : 100;

    // Calculate average quote collection time (historical)
    const averageQuoteCollectionTimeMs = this.stats.totalOrdersProcessed > 0
      ? this.stats.totalQuoteTimeMs / this.stats.totalOrdersProcessed
      : 0;

    // Calculate per-DEX success rates
    const calculateDexRate = (dex: keyof typeof this.stats.quotesByDex) => {
      const { success, failed } = this.stats.quotesByDex[dex];
      const total = success + failed;
      return {
        success,
        failed,
        successRate: total > 0 ? (success / total) * 100 : 100,
      };
    };

    return {
      // Real-time stats
      activeOrders,
      pendingTimeouts,
      averageQuoteTime: Math.round(averageQuoteTime),
      
      // Cumulative stats
      totalOrdersProcessed: this.stats.totalOrdersProcessed,
      totalQuotesCollected: this.stats.totalQuotesCollected,
      totalQuotesFailed: this.stats.totalQuotesFailed,
      quoteSuccessRate: Math.round(quoteSuccessRate * 100) / 100,
      successfulExecutions: this.stats.successfulExecutions,
      failedExecutions: this.stats.failedExecutions,
      executionSuccessRate: Math.round(executionSuccessRate * 100) / 100,
      averageQuoteCollectionTimeMs: Math.round(averageQuoteCollectionTimeMs),
      
      // Per-DEX statistics
      dexPerformance: {
        raydium: calculateDexRate('raydium'),
        meteora: calculateDexRate('meteora'),
        orca: calculateDexRate('orca'),
        jupiter: calculateDexRate('jupiter'),
      },
      
      // Strategy usage
      strategyUsage: this.stats.strategyUsage,
    };
  }

  /**
   * PHASE 3: Reset statistics (for testing)
   */
  resetStatistics(): void {
    this.stats = {
      totalOrdersProcessed: 0,
      totalQuotesCollected: 0,
      totalQuotesFailed: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalQuoteTimeMs: 0,
      quotesByDex: {
        raydium: { success: 0, failed: 0 },
        meteora: { success: 0, failed: 0 },
        orca: { success: 0, failed: 0 },
        jupiter: { success: 0, failed: 0 },
      },
      strategyUsage: {
        BEST_PRICE: 0,
        LOWEST_SLIPPAGE: 0,
        HIGHEST_LIQUIDITY: 0,
        FASTEST_EXECUTION: 0,
      },
    };
    console.log('[JobScheduler] Statistics reset');
  }

  /**
   * Cleanup for graceful shutdown
   */
  cleanup(): void {
    console.log('[JobScheduler] Cleaning up...');
    
    // Clear all timeouts
    for (const timeout of this.quoteTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.quoteTimeouts.clear();
    
    // Clear quote tracking
    this.orderQuotes.clear();
    
    console.log('[JobScheduler] Cleanup complete');
  }
}
