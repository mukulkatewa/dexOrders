// src/services/routingHub.ts
// PHASE 3: Intelligent DEX Routing with Tuple-Based Selection

import { RoutingStrategy } from '../types';

/**
 * Quote Tuple Representation (Ani's Pattern)
 * Each quote is represented as: (P, O, S, L, D)
 * - P: Price per token
 * - O: Output amount (tokens received)
 * - S: Slippage (price impact)
 * - L: Liquidity (pool depth)
 * - D: DEX provider identifier
 */
interface QuoteTuple {
  price: number;           // P
  outputAmount: number;    // O
  slippage: number;        // S
  liquidity: number;       // L
  provider: string;        // D
  
  // Original quote data for reference
  originalQuote?: any;
}

/**
 * Routing Analysis Result
 */
interface RoutingAnalysis {
  selectedRoute: QuoteTuple;
  allRoutes: QuoteTuple[];
  marketMetrics: {
    priceSpread: number;
    priceSpreadPercentage: number;
    averagePrice: number;
    bestOutputAmount: number;
    worstOutputAmount: number;
    averageSlippage: number;
    totalLiquidity: number;
  };
  strategyAnalysis: Record<RoutingStrategy, QuoteTuple | null>;
  recommendation: QuoteTuple;
  timestamp: string;
}

/**
 * User Preferences for Route Filtering
 */
interface UserPreferences {
  excludeDEXs?: string[];
  minLiquidity?: number;
  maxSlippage?: number;
  preferredDEX?: string;
}

/**
 * RoutingHub - Intelligent DEX Selection Engine
 * Based on Ani's hub.js with tuple-based mathematical optimization
 * 
 * Why Tuple-Based?
 * - Enables mathematical optimization functions
 * - Separates data from algorithm
 * - Makes strategy switching efficient
 * - Allows easy addition of new metrics
 */
export class RoutingHub {
  // DEX speed rankings for FASTEST_EXECUTION strategy
  private readonly speedRank: Record<string, number> = {
    jupiter: 4,   // Fastest (aggregator)
    meteora: 3,   // Fast (DLMM)
    orca: 2,      // Medium (Whirlpool)
    raydium: 1,   // Standard (AMM)
  };

  constructor() {
    console.log('[RoutingHub] Initialized with 4 routing strategies');
  }

  /**
   * Main routing function - selects best route based on strategy
   * This is the entry point for all routing decisions
   */
  selectBestRoute(
    quotes: any[],
    strategy: RoutingStrategy = 'BEST_PRICE',
    userPreferences?: UserPreferences
  ): QuoteTuple {
    console.log(`[RoutingHub] Selecting route for ${quotes.length} quotes using ${strategy}`);

    // Validate quotes
    if (!quotes || quotes.length === 0) {
      throw new Error('No quotes available for routing');
    }

    // Convert quotes to tuple representation
    const tuples = this.convertToTuples(quotes);
    console.log(`[RoutingHub] Converted ${tuples.length} quotes to tuples`);

    // Apply user preference filters
    let filteredTuples = tuples;
    if (userPreferences) {
      filteredTuples = this.applyUserPreferences(tuples, userPreferences);
      console.log(`[RoutingHub] After filtering: ${filteredTuples.length} routes available`);
    }

    if (filteredTuples.length === 0) {
      throw new Error('No routes available after applying user preferences');
    }

    // Apply routing strategy (mathematical optimization)
    const selectedRoute = this.applyRoutingStrategy(filteredTuples, strategy);
    console.log(`[RoutingHub] Selected ${selectedRoute.provider} with output ${selectedRoute.outputAmount}`);

    return selectedRoute;
  }

  /**
   * Convert raw quotes to tuple representation
   * Tuple: (P, O, S, L, D)
   */
  private convertToTuples(quotes: any[]): QuoteTuple[] {
    return quotes.map(quote => ({
      price: quote.price || 0,
      outputAmount: quote.estimatedOutput || quote.outputAmount || 0,
      slippage: quote.slippage || quote.priceImpact || 0,
      liquidity: quote.liquidity || 0,
      provider: quote.provider || quote.dex || 'unknown',
      originalQuote: quote,
    }));
  }

  /**
   * Apply routing strategy using objective functions (Ani's pattern)
   * Each strategy has a mathematical optimization goal
   */
  private applyRoutingStrategy(
    tuples: QuoteTuple[],
    strategy: RoutingStrategy
  ): QuoteTuple {
    switch (strategy) {
      case 'BEST_PRICE':
        return this.getBestPrice(tuples);
      
      case 'LOWEST_SLIPPAGE':
        return this.getLowestSlippage(tuples);
      
      case 'HIGHEST_LIQUIDITY':
        return this.getHighestLiquidity(tuples);
      
      case 'FASTEST_EXECUTION':
        return this.getFastestExecution(tuples);
      
      default:
        console.warn(`[RoutingHub] Unknown strategy ${strategy}, using BEST_PRICE`);
        return this.getBestPrice(tuples);
    }
  }

  /**
   * STRATEGY 1: Best Price (argmax O_i)
   * Selects quote with maximum output amount
   * Mathematical: argmax{O_i for i in Q}
   */
  private getBestPrice(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) =>
      current.outputAmount > best.outputAmount ? current : best
    );
  }

  /**
   * STRATEGY 2: Lowest Slippage (argmin S_i)
   * Selects quote with minimum price impact
   * Mathematical: argmin{S_i for i in Q}
   */
  private getLowestSlippage(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) =>
      current.slippage < best.slippage ? current : best
    );
  }

  /**
   * STRATEGY 3: Highest Liquidity (argmax L_i)
   * Selects quote with maximum pool liquidity
   * Mathematical: argmax{L_i for i in Q}
   */
  private getHighestLiquidity(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) =>
      current.liquidity > best.liquidity ? current : best
    );
  }

  /**
   * STRATEGY 4: Fastest Execution (argmax speed_rank(D_i))
   * Selects based on predefined DEX speed rankings
   * Mathematical: argmax{speedRank(D_i) for i in Q}
   */
  private getFastestExecution(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) => {
      const currentSpeed = this.speedRank[current.provider.toLowerCase()] || 0;
      const bestSpeed = this.speedRank[best.provider.toLowerCase()] || 0;
      return currentSpeed > bestSpeed ? current : best;
    });
  }

  /**
   * Apply user preference filters
   */
  private applyUserPreferences(
    tuples: QuoteTuple[],
    preferences: UserPreferences
  ): QuoteTuple[] {
    let filtered = tuples;

    // Exclude specific DEXs
    if (preferences.excludeDEXs && preferences.excludeDEXs.length > 0) {
      const excludeSet = new Set(preferences.excludeDEXs.map(d => d.toLowerCase()));
      filtered = filtered.filter(t => !excludeSet.has(t.provider.toLowerCase()));
      console.log(`[RoutingHub] Excluded DEXs: ${preferences.excludeDEXs.join(', ')}`);
    }

    // Minimum liquidity filter
    if (preferences.minLiquidity !== undefined) {
      filtered = filtered.filter(t => t.liquidity >= preferences.minLiquidity!);
      console.log(`[RoutingHub] Filtered by min liquidity: ${preferences.minLiquidity}`);
    }

    // Maximum slippage filter
    if (preferences.maxSlippage !== undefined) {
      filtered = filtered.filter(t => t.slippage <= preferences.maxSlippage!);
      console.log(`[RoutingHub] Filtered by max slippage: ${preferences.maxSlippage}`);
    }

    // Preferred DEX (if available, prioritize it)
    if (preferences.preferredDEX) {
      const preferred = filtered.find(
        t => t.provider.toLowerCase() === preferences.preferredDEX!.toLowerCase()
      );
      if (preferred) {
        console.log(`[RoutingHub] Preferred DEX ${preferences.preferredDEX} is available`);
        return [preferred, ...filtered.filter(t => t !== preferred)];
      }
    }

    return filtered;
  }

  /**
   * Get comprehensive routing analysis for all strategies
   * Useful for UI to show comparisons
   */
  getRoutingAnalysis(
    quotes: any[],
    userPreferences?: UserPreferences
  ): RoutingAnalysis {
    console.log(`[RoutingHub] Generating routing analysis for ${quotes.length} quotes`);

    const tuples = this.convertToTuples(quotes);
    const filteredTuples = userPreferences
      ? this.applyUserPreferences(tuples, userPreferences)
      : tuples;

    // Calculate market metrics
    const prices = tuples.map(t => t.price);
    const outputs = tuples.map(t => t.outputAmount);
    const slippages = tuples.map(t => t.slippage);
    const liquidities = tuples.map(t => t.liquidity);

    const marketMetrics = {
      priceSpread: Math.max(...prices) - Math.min(...prices),
      priceSpreadPercentage: ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100,
      averagePrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
      bestOutputAmount: Math.max(...outputs),
      worstOutputAmount: Math.min(...outputs),
      averageSlippage: slippages.reduce((sum, s) => sum + s, 0) / slippages.length,
      totalLiquidity: liquidities.reduce((sum, l) => sum + l, 0),
    };

    // Get best route for each strategy
    const strategyAnalysis: Record<RoutingStrategy, QuoteTuple | null> = {
      BEST_PRICE: null,
      LOWEST_SLIPPAGE: null,
      HIGHEST_LIQUIDITY: null,
      FASTEST_EXECUTION: null,
    };

    if (filteredTuples.length > 0) {
      strategyAnalysis.BEST_PRICE = this.getBestPrice(filteredTuples);
      strategyAnalysis.LOWEST_SLIPPAGE = this.getLowestSlippage(filteredTuples);
      strategyAnalysis.HIGHEST_LIQUIDITY = this.getHighestLiquidity(filteredTuples);
      strategyAnalysis.FASTEST_EXECUTION = this.getFastestExecution(filteredTuples);
    }

    return {
      selectedRoute: strategyAnalysis.BEST_PRICE!,
      allRoutes: filteredTuples,
      marketMetrics,
      strategyAnalysis,
      recommendation: strategyAnalysis.BEST_PRICE!,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Compare two quotes
   */
  compareQuotes(quoteA: any, quoteB: any): {
    outputDifference: number;
    outputDifferencePercentage: number;
    priceDifference: number;
    slippageDifference: number;
    liquidityDifference: number;
    betterChoice: string;
  } {
    const tupleA = this.convertToTuples([quoteA])[0];
    const tupleB = this.convertToTuples([quoteB])[0];

    return {
      outputDifference: tupleB.outputAmount - tupleA.outputAmount,
      outputDifferencePercentage: ((tupleB.outputAmount - tupleA.outputAmount) / tupleA.outputAmount) * 100,
      priceDifference: tupleB.price - tupleA.price,
      slippageDifference: tupleB.slippage - tupleA.slippage,
      liquidityDifference: tupleB.liquidity - tupleA.liquidity,
      betterChoice: tupleB.outputAmount > tupleA.outputAmount ? tupleB.provider : tupleA.provider,
    };
  }

  /**
   * Validate quotes before routing
   */
  validateQuotes(quotes: any[]): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!quotes || quotes.length === 0) {
      errors.push('No quotes provided');
      return { valid: false, errors, warnings };
    }

    quotes.forEach((quote, index) => {
      if (!quote.provider && !quote.dex) {
        errors.push(`Quote ${index}: Missing provider`);
      }
      if (!quote.estimatedOutput && !quote.outputAmount) {
        errors.push(`Quote ${index}: Invalid output amount`);
      }
      if ((quote.slippage || quote.priceImpact || 0) > 0.1) {
        warnings.push(`Quote ${index} (${quote.provider || quote.dex}): High slippage ${((quote.slippage || quote.priceImpact) * 100).toFixed(2)}%`);
      }
      if ((quote.liquidity || 0) < 100000) {
        warnings.push(`Quote ${index} (${quote.provider || quote.dex}): Low liquidity ${quote.liquidity}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get available routing strategies
   */
  getAvailableStrategies(): {
    strategies: RoutingStrategy[];
    default: RoutingStrategy;
    descriptions: Record<RoutingStrategy, string>;
  } {
    return {
      strategies: ['BEST_PRICE', 'LOWEST_SLIPPAGE', 'HIGHEST_LIQUIDITY', 'FASTEST_EXECUTION'],
      default: 'BEST_PRICE',
      descriptions: {
        BEST_PRICE: 'Selects DEX with highest output amount (maximum tokens received)',
        LOWEST_SLIPPAGE: 'Selects DEX with lowest price impact (minimal slippage)',
        HIGHEST_LIQUIDITY: 'Selects DEX with highest pool liquidity (most stable)',
        FASTEST_EXECUTION: 'Selects fastest DEX for execution (lowest latency)',
      },
    };
  }
}
