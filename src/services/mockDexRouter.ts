// src/services/mockDexRouter.ts
// PHASE 2: Added individual DEX quote methods for parallel worker processing

export interface DexQuote {
  dex: string;
  price: number;
  fee: number;
  estimatedOutput: number;
  slippage: number;
  liquidity: number;
  latencyMs: number;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  amountOut: number;
  dex: string;
}

export type RoutingStrategy =
  | 'BEST_PRICE'
  | 'LOWEST_SLIPPAGE'
  | 'HIGHEST_LIQUIDITY'
  | 'FASTEST_EXECUTION';

/**
 * MockDexRouter simulates DEX interactions
 * PHASE 2: Added individual DEX methods for targeted quote fetching
 */
export class MockDexRouter {
  constructor(
    private quoteDelayMs: number = 0,
    private swapDelayMs: number = 0,
  ) {}

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate realistic quote for a specific DEX
   * Each DEX has unique characteristics:
   * - Raydium: Baseline, medium latency
   * - Meteora: Slightly worse price, slower
   * - Orca: Best price, slowest
   * - Jupiter: Aggregator, fastest
   */
  private generateQuote(dex: string, amount: number): DexQuote {
    const basePrice = 0.05;
    const dexSpread =
      dex === 'raydium' ? 0.0 :
      dex === 'meteora' ? 0.0005 :
      dex === 'orca' ? -0.0003 :
      0.0002;
    const randomFactor = 0.98 + Math.random() * 0.04;
    const price = basePrice * randomFactor + dexSpread;

    const fee = 0.003;
    const slippage = 0.001 + Math.random() * 0.004;
    const liquidity = 1_000_000 + Math.random() * 9_000_000;
    const latencyMs =
      dex === 'jupiter' ? 80 :
      dex === 'raydium' ? 100 :
      dex === 'meteora' ? 120 :
      140;

    const estimatedOutput = amount * price * (1 - fee - slippage);

    return { dex, price, fee, estimatedOutput, slippage, liquidity, latencyMs };
  }

  /**
   * PHASE 2: Individual DEX Quote Methods
   * These allow workers to fetch from specific DEXs in parallel
   */

  /**
   * Get quote specifically from Raydium
   * Used by Raydium worker for targeted quote fetching
   */
  async getRaydiumQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.delay(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Raydium quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('raydium', amount);
  }

  /**
   * Get quote specifically from Meteora
   * Used by Meteora worker for targeted quote fetching
   */
  async getMeteorQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.delay(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Meteora quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('meteora', amount);
  }

  /**
   * Get quote specifically from Orca
   * Used by Orca worker for targeted quote fetching
   */
  async getOrcaQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.delay(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Orca quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('orca', amount);
  }

  /**
   * Get quote specifically from Jupiter
   * Used by Jupiter worker for targeted quote fetching
   */
  async getJupiterQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    await this.delay(this.quoteDelayMs);
    console.log(`[MockDexRouter] Fetching Jupiter quote for ${tokenIn}/${tokenOut}`);
    return this.generateQuote('jupiter', amount);
  }

  /**
   * Get quotes from all DEXs (original method - kept for backward compatibility)
   * This is now less efficient than using individual methods in parallel
   */
  async getQuotes(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote[]> {
    await this.delay(this.quoteDelayMs);
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
   * Get best quote using routing strategy
   * This method is kept for HTTP API endpoints
   * Workers should use individual DEX methods for parallel processing
   */
  async getBestQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    strategy: RoutingStrategy = 'BEST_PRICE',
  ): Promise<DexQuote> {
    const quotes = await this.getQuotes(tokenIn, tokenOut, amount);
    return this.selectBest(quotes, strategy);
  }

  /**
   * PHASE 2: Get best quote from specific set of quotes
   * Used by JobScheduler after parallel quote collection
   */
  selectBestFromQuotes(quotes: DexQuote[], strategy: RoutingStrategy): DexQuote {
    return this.selectBest(quotes, strategy);
  }

  /**
   * Execute swap on selected DEX
   */
  async executeSwap(
    quote: DexQuote,
    _tokenIn: string,
    _tokenOut: string,
    _amount: number,
  ): Promise<SwapResult> {
    await this.delay(this.swapDelayMs);
    
    console.log(`[MockDexRouter] Executing swap on ${quote.dex}`);
    
    // Generate realistic transaction hash
    const txHash =
      '5' + Array.from({ length: 87 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    
    return {
      txHash,
      executedPrice: quote.price,
      amountOut: quote.estimatedOutput,
      dex: quote.dex,
    };
  }

  /**
   * PHASE 2: Execute swap on specific DEX
   * Allows workers to execute on their designated DEX
   */
  async executeSwapOnDex(
    dex: string,
    tokenIn: string,
    tokenOut: string,
    amount: number,
  ): Promise<SwapResult> {
    console.log(`[MockDexRouter] Executing swap on ${dex} for ${tokenIn}/${tokenOut}`);
    
    // Get quote from specific DEX
    let quote: DexQuote;
    switch (dex) {
      case 'raydium':
        quote = await this.getRaydiumQuote(tokenIn, tokenOut, amount);
        break;
      case 'meteora':
        quote = await this.getMeteorQuote(tokenIn, tokenOut, amount);
        break;
      case 'orca':
        quote = await this.getOrcaQuote(tokenIn, tokenOut, amount);
        break;
      case 'jupiter':
        quote = await this.getJupiterQuote(tokenIn, tokenOut, amount);
        break;
      default:
        throw new Error(`Unknown DEX: ${dex}`);
    }

    // Execute swap
    return await this.executeSwap(quote, tokenIn, tokenOut, amount);
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
}
