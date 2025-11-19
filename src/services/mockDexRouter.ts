// src/services/mockDexRouter.ts
// PHASE 2: Individual DEX quote methods for parallel worker processing

export interface DexQuote {
  dex: string;
  provider?: string; // Alias for dex (used by RoutingHub)
  price: number;
  fee: number;
  estimatedOutput: number;
  outputAmount?: number; // Alias for estimatedOutput (used by RoutingHub)
  slippage: number;
  priceImpact?: number; // Alias for slippage
  liquidity: number;
  latencyMs: number;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  amountOut: number;
  dex: string;
  success: boolean;
  timestamp: string;
}

export type RoutingStrategy =
  | 'BEST_PRICE'
  | 'LOWEST_SLIPPAGE'
  | 'HIGHEST_LIQUIDITY'
  | 'FASTEST_EXECUTION';

/**
 * MockDexRouter simulates DEX interactions
 * PHASE 2: Individual DEX methods for targeted quote fetching
 */
export class MockDexRouter {
  constructor(
    private quoteDelayMs: number = 0,
    private swapDelayMs: number = 0
  ) {}

  /**
   * Sleep utility for simulating delays
   */
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate realistic mock transaction hash
   */
  private generateMockTxHash(): string {
    return (
      '5' +
      Array.from({ length: 87 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    );
  }

  /**
   * Generate realistic quote for a specific DEX
   * Each DEX has unique characteristics:
   * - Raydium: Baseline AMM, medium latency
   * - Meteora: DLMM with dynamic bins, lower slippage
   * - Orca: Concentrated liquidity (Whirlpool), best prices
   * - Jupiter: Aggregator, fastest execution
   */
  private generateQuote(dex: string, amount: number): DexQuote {
    const basePrice = 0.05;

    // DEX-specific price adjustments
    const dexSpread =
      dex === 'raydium'
        ? 0.0
        : dex === 'meteora'
        ? 0.0005
        : dex === 'orca'
        ? -0.0003
        : 0.0002;

    const randomFactor = 0.98 + Math.random() * 0.04;
    const price = basePrice * randomFactor + dexSpread;

    // DEX-specific fee structures
    const fee =
      dex === 'jupiter'
        ? 0.0025 // Aggregator fee
        : dex === 'orca'
        ? 0.002 // Concentrated liquidity
        : 0.003; // Standard AMM

    // DEX-specific slippage characteristics
    const baseSlippage = 0.001 + Math.random() * 0.004;
    const slippage =
      dex === 'meteora'
        ? baseSlippage * 0.7 // DLMM reduces slippage
        : dex === 'orca'
        ? baseSlippage * 0.8 // Concentrated liquidity
        : baseSlippage;

    // DEX-specific liquidity ranges
    const liquidityBase =
      dex === 'jupiter'
        ? 5_000_000 // Aggregated liquidity
        : dex === 'orca'
        ? 3_000_000
        : dex === 'meteora'
        ? 2_000_000
        : 1_500_000;

    const liquidity = liquidityBase + Math.random() * liquidityBase;

    // DEX-specific latency
    const latencyMs =
      dex === 'jupiter'
        ? 80 // Fastest (aggregator optimization)
        : dex === 'raydium'
        ? 100
        : dex === 'meteora'
        ? 120
        : 140; // Orca slowest (concentrated liquidity calculations)

    const estimatedOutput = amount * price * (1 - fee - slippage);

    return {
      dex,
      provider: dex, // Alias for RoutingHub compatibility
      price,
      fee,
      estimatedOutput,
      outputAmount: estimatedOutput, // Alias for RoutingHub compatibility
      slippage,
      priceImpact: slippage, // Alias for RoutingHub compatibility
      liquidity,
      latencyMs,
    };
  }

  /**
   * PHASE 2: Individual DEX Quote Methods
   * These allow workers to fetch from specific DEXs in parallel
   */

  /**
   * Get quote from Raydium AMM
   */
  async getRaydiumQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.sleep(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Raydium quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('raydium', amount);
  }

  /**
   * Get quote from Meteora DLMM
   */
  async getMeteoraQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.sleep(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Meteora quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('meteora', amount);
  }

  /**
   * Get quote from Orca Whirlpool
   */
  async getOrcaQuote(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote> {
    await this.sleep(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Orca quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('orca', amount);
  }

  /**
   * Get quote from Jupiter aggregator
   */
  async getJupiterQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.sleep(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Jupiter quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('jupiter', amount);
  }

  /**
   * Get quotes from all DEXs (sequential - kept for backward compatibility)
   * Workers should use individual methods for true parallel processing
   */
  async getQuotes(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote[]> {
    await this.sleep(this.quoteDelayMs);
    return [
      this.generateQuote('raydium', amount),
      this.generateQuote('meteora', amount),
      this.generateQuote('orca', amount),
      this.generateQuote('jupiter', amount),
    ];
  }

  /**
   * Select best quote based on routing strategy
   */
  private selectBest(quotes: DexQuote[], strategy: RoutingStrategy): DexQuote {
    if (quotes.length === 0) {
      throw new Error('No quotes available');
    }

    switch (strategy) {
      case 'BEST_PRICE':
        return quotes.reduce((best, q) => (q.estimatedOutput > best.estimatedOutput ? q : best));
      case 'LOWEST_SLIPPAGE':
        return quotes.reduce((best, q) => (q.slippage < best.slippage ? q : best));
      case 'HIGHEST_LIQUIDITY':
        return quotes.reduce((best, q) => (q.liquidity > best.liquidity ? q : best));
      case 'FASTEST_EXECUTION':
        return quotes.reduce((best, q) => (q.latencyMs < best.latencyMs ? q : best));
      default:
        return quotes[0];
    }
  }

  /**
   * Get best quote using routing strategy (HTTP API endpoint)
   */
  async getBestQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    strategy: RoutingStrategy = 'BEST_PRICE'
  ): Promise<DexQuote> {
    const quotes = await this.getQuotes(tokenIn, tokenOut, amount);
    return this.selectBest(quotes, strategy);
  }

  /**
   * PHASE 2: Select best quote from pre-fetched quotes
   * Used by RoutingHub after parallel quote collection
   */
  selectBestFromQuotes(quotes: DexQuote[], strategy: RoutingStrategy): DexQuote {
    return this.selectBest(quotes, strategy);
  }

  /**
   * Execute swap on selected DEX (original method)
   */
  async executeSwap(
    quote: DexQuote,
    _tokenIn: string,
    _tokenOut: string,
    _amount: number
  ): Promise<SwapResult> {
    await this.sleep(this.swapDelayMs);

    console.log(`[MockDexRouter] Executing swap on ${quote.dex}`);

    const txHash = this.generateMockTxHash();

    return {
      success: true,
      txHash,
      executedPrice: quote.price,
      amountOut: quote.estimatedOutput,
      dex: quote.dex,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * PHASE 2: Execute swap on specific DEX (used by workers)
   * PHASE 2 FIX: Case-insensitive DEX name handling
   */
  async executeSwapOnDex(
    dex: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    wallet?: string
  ): Promise<SwapResult> {
    // PHASE 2 FIX: Normalize DEX name to lowercase
    const normalizedDex = dex.toLowerCase();

    console.log(`[MockDexRouter] Executing swap on ${normalizedDex} for ${tokenIn}/${tokenOut}`);

    // Validate DEX support
    if (!this.isSupportedDex(normalizedDex)) {
      throw new Error(`Unknown DEX: ${dex} (normalized: ${normalizedDex})`);
    }

    // Get quote first to calculate output
    let quote: DexQuote;
    switch (normalizedDex) {
      case 'raydium':
        quote = await this.getRaydiumQuote(tokenIn, tokenOut, amountIn);
        break;
      case 'meteora':
        quote = await this.getMeteoraQuote(tokenIn, tokenOut, amountIn);
        break;
      case 'orca':
        quote = await this.getOrcaQuote(tokenIn, tokenOut, amountIn);
        break;
      case 'jupiter':
        quote = await this.getJupiterQuote(tokenIn, tokenOut, amountIn);
        break;
      default:
        throw new Error(`Unknown DEX: ${dex}`);
    }

    // Simulate swap execution delay (realistic blockchain latency)
    await this.sleep(1000 + Math.random() * 2000);

    console.log(`[MockDexRouter] Executing swap on ${normalizedDex}`);

    const txHash = this.generateMockTxHash();

    return {
      success: true,
      dex: normalizedDex,
      txHash,
      executedPrice: quote.price,
      amountOut: quote.estimatedOutput,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate if DEX name is supported
   */
  isSupportedDex(dex: string): boolean {
    return ['raydium', 'meteora', 'orca', 'jupiter'].includes(dex.toLowerCase());
  }

  /**
   * Get all supported DEX names
   */
  getSupportedDexes(): string[] {
    return ['raydium', 'meteora', 'orca', 'jupiter'];
  }

  /**
   * Get DEX metadata (for API endpoints)
   */
  getDexMetadata() {
    return {
      raydium: {
        name: 'Raydium',
        type: 'AMM',
        avgLatency: 100,
        description: 'Standard automated market maker on Solana',
      },
      meteora: {
        name: 'Meteora',
        type: 'DLMM',
        avgLatency: 120,
        description: 'Dynamic liquidity market maker with adaptive bins',
      },
      orca: {
        name: 'Orca',
        type: 'Whirlpool',
        avgLatency: 140,
        description: 'Concentrated liquidity pools for capital efficiency',
      },
      jupiter: {
        name: 'Jupiter',
        type: 'Aggregator',
        avgLatency: 80,
        description: 'DEX aggregator finding best routes across all DEXs',
      },
    };
  }
}
