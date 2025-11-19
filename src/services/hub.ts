/**
 * DEX Routing Hub - Intelligent Route Selection
 * Based on Ani's hub.js with tuple-based mathematical optimization
 * 
 * Quote Representation: qi = (Pi, Oi, Si, Li, Di)
 * Where:
 * - Pi: Price per token
 * - Oi: Output amount
 * - Si: Slippage (price impact)
 * - Li: Liquidity
 * - Di: DEX identifier
 */

import { RoutingStrategy } from '../types';

/**
 * Quote Tuple - Mathematical representation of a DEX quote
 */
export interface QuoteTuple {
  price: number;           // Pi
  outputAmount: number;    // Oi
  slippage: number;        // Si
  liquidity: number;       // Li
  provider: string;        // Di
  originalQuote?: any;
}

/**
 * Market Analysis Metrics
 */
export interface MarketMetrics {
  priceSpread: number;
  priceSpreadPercentage: number;
  averagePrice: number;
  bestOutputAmount: number;
  worstOutputAmount: number;
  averageSlippage: number;
  totalLiquidity: number;
}

/**
 * Routing Analysis Result
 */
export interface RoutingAnalysis {
  totalQuotes: number;
  marketMetrics: MarketMetrics;
  strategyAnalysis: Record<RoutingStrategy, QuoteTuple | null>;
  recommendation: QuoteTuple;
  timestamp: string;
}

/**
 * User Preferences for Route Filtering
 */
export interface UserPreferences {
  excludeDEXs?: string[];
  minLiquidity?: number;
  maxSlippage?: number;
  preferredDEX?: string;
}

/**
 * Quote Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * RoutingHub - Intelligent DEX Selection Engine
 * Implements Ani's mathematical tuple-based optimization
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
   * Entry point for all routing decisions
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
    return quotes.map((quote) => ({
      price: quote.price || 0,
      outputAmount: quote.estimatedOutput || quote.outputAmount || 0,
      slippage: quote.slippage || quote.priceImpact || 0,
      liquidity: quote.liquidity || 0,
      provider: (quote.provider || quote.dex || 'unknown').toLowerCase(),
      originalQuote: quote,
    }));
  }

  /**
   * Apply routing strategy using objective functions (Ani's pattern)
   * Each strategy has a mathematical optimization goal
   */
  private applyRoutingStrategy(tuples: QuoteTuple[], strategy: RoutingStrategy): QuoteTuple {
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
   * Objective Function 1: argmax(Oi) - Highest output amount
   */
  private getBestPrice(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) =>
      current.outputAmount > best.outputAmount ? current : best
    );
  }

  /**
   * Objective Function 2: argmin(Si) - Lowest slippage
   */
  private getLowestSlippage(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) => (current.slippage < best.slippage ? current : best));
  }

  /**
   * Objective Function 3: argmax(Li) - Highest liquidity
   */
  private getHighestLiquidity(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) =>
      current.liquidity > best.liquidity ? current : best
    );
  }

  /**
   * Objective Function 4: argmax(speed_rank(Di)) - Fastest execution
   */
  private getFastestExecution(tuples: QuoteTuple[]): QuoteTuple {
    return tuples.reduce((best, current) => {
      const currentSpeed = this.speedRank[current.provider] || 0;
      const bestSpeed = this.speedRank[best.provider] || 0;
      return currentSpeed > bestSpeed ? current : best;
    });
  }

  /**
   * Apply user preferences to filter routes
   */
  private applyUserPreferences(
    tuples: QuoteTuple[],
    preferences: UserPreferences
  ): QuoteTuple[] {
    let filtered = tuples;

    // Exclude specific DEXs
    if (preferences.excludeDEXs && preferences.excludeDEXs.length > 0) {
      filtered = filtered.filter(
        (t) => !preferences.excludeDEXs!.includes(t.provider.toLowerCase())
      );
    }

    // Minimum liquidity filter
    if (preferences.minLiquidity !== undefined) {
      filtered = filtered.filter((t) => t.liquidity >= preferences.minLiquidity!);
    }

    // Maximum slippage filter
    if (preferences.maxSlippage !== undefined) {
      filtered = filtered.filter((t) => t.slippage <= preferences.maxSlippage!);
    }

    return filtered;
  }

  /**
   * Get comprehensive routing analysis for all strategies
   */
  getRoutingAnalysis(quotes: any[]): RoutingAnalysis {
    if (!quotes || quotes.length === 0) {
      throw new Error('No quotes available for analysis');
    }

    const tuples = this.convertToTuples(quotes);

    // Get best route for each strategy
    const strategyAnalysis: Record<RoutingStrategy, QuoteTuple | null> = {
      BEST_PRICE: null,
      LOWEST_SLIPPAGE: null,
      HIGHEST_LIQUIDITY: null,
      FASTEST_EXECUTION: null,
    };

    const strategies: RoutingStrategy[] = [
      'BEST_PRICE',
      'LOWEST_SLIPPAGE',
      'HIGHEST_LIQUIDITY',
      'FASTEST_EXECUTION',
    ];

    strategies.forEach((strategy) => {
      try {
        strategyAnalysis[strategy] = this.applyRoutingStrategy(tuples, strategy);
      } catch (error) {
        console.error(`[RoutingHub] Failed to analyze ${strategy}:`, error);
        strategyAnalysis[strategy] = null;
      }
    });

    // Calculate market metrics
    const prices = tuples.map((t) => t.price);
    const outputAmounts = tuples.map((t) => t.outputAmount);
    const slippages = tuples.map((t) => t.slippage);
    const liquidities = tuples.map((t) => t.liquidity);

    const marketMetrics: MarketMetrics = {
      priceSpread: Math.max(...prices) - Math.min(...prices),
      priceSpreadPercentage:
        ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100,
      averagePrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
      bestOutputAmount: Math.max(...outputAmounts),
      worstOutputAmount: Math.min(...outputAmounts),
      averageSlippage: slippages.reduce((sum, s) => sum + s, 0) / slippages.length,
      totalLiquidity: liquidities.reduce((sum, l) => sum + l, 0),
    };

    return {
      totalQuotes: tuples.length,
      marketMetrics,
      strategyAnalysis,
      recommendation: strategyAnalysis.BEST_PRICE!,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate quotes before routing
   */
  validateQuotes(quotes: any[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!quotes || quotes.length === 0) {
      errors.push('No quotes provided');
      return { valid: false, errors, warnings };
    }

    quotes.forEach((quote, index) => {
      const provider = quote.provider || quote.dex;
      const outputAmount = quote.estimatedOutput || quote.outputAmount;

      if (!provider) {
        errors.push(`Quote ${index}: Missing provider`);
      }

      if (!outputAmount || outputAmount <= 0) {
        errors.push(`Quote ${index}: Invalid output amount`);
      }

      const slippage = quote.slippage || quote.priceImpact || 0;
      if (slippage > 10) {
        warnings.push(`Quote ${index} (${provider}): High price impact (${slippage}%)`);
      }

      const liquidity = quote.liquidity || 0;
      if (liquidity < 100000) {
        warnings.push(`Quote ${index} (${provider}): Low liquidity ($${liquidity})`);
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
  getAvailableStrategies() {
    return {
      strategies: ['BEST_PRICE', 'LOWEST_SLIPPAGE', 'HIGHEST_LIQUIDITY', 'FASTEST_EXECUTION'],
      default: 'BEST_PRICE' as RoutingStrategy,
      descriptions: {
        BEST_PRICE: 'Selects DEX with highest output amount',
        LOWEST_SLIPPAGE: 'Selects DEX with lowest price impact',
        HIGHEST_LIQUIDITY: 'Selects DEX with highest pool liquidity',
        FASTEST_EXECUTION: 'Selects fastest DEX for execution',
      },
    };
  }
}
