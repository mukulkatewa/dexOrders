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

export class MockDexRouter {
  constructor(
    private quoteDelayMs: number = 0,
    private swapDelayMs: number = 0,
  ) {}

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

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

  async getQuotes(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote[]> {
    await this.delay(this.quoteDelayMs);
    return [
      this.generateQuote('raydium', amount),
      this.generateQuote('meteora', amount),
      this.generateQuote('orca', amount),
      this.generateQuote('jupiter', amount),
    ];
  }

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

  async getBestQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    strategy: RoutingStrategy = 'BEST_PRICE',
  ): Promise<DexQuote> {
    const quotes = await this.getQuotes(tokenIn, tokenOut, amount);
    return this.selectBest(quotes, strategy);
  }

  async executeSwap(
    quote: DexQuote,
    _tokenIn: string,
    _tokenOut: string,
    _amount: number,
  ): Promise<SwapResult> {
    await this.delay(this.swapDelayMs);
    const txHash =
      '5' + Array.from({ length: 87 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return {
      txHash,
      executedPrice: quote.price,
      amountOut: quote.estimatedOutput,
      dex: quote.dex,
    };
  }
}
