import { MockDexRouter, DexQuote } from '../services/mockDexRouter';

// Interface for arbitrage opportunity details
export interface ArbitrageOpportunity {
  tokenIn: string;
  tokenOut: string;
  raydiumPrice: number;
  meteoraPrice: number;
  priceDifference: number;
  profitPercentage: number;
}

// Bot to detect arbitrage opportunities between two DEXs
export class ArbitrageBot {
  private router = new MockDexRouter();
  private threshold: number;

  // threshold percentage for arbitrage alert (default 2%)
  constructor(thresholdPercent = 2) {
    this.threshold = thresholdPercent;
  }

  // Detect arbitrage by fetching multiple quotes, filtering by dex
  async checkArbitrage(tokenIn: string, tokenOut: string, amountIn: number): Promise<ArbitrageOpportunity | null> {
    try {
      // Fetch multiple quotes since only getBestQuote exists
      const quotes: DexQuote[] = [];
      for (let i = 0; i < 5; i++) {
        const q = await this.router.getBestQuote(tokenIn, tokenOut, amountIn);
        quotes.push(q);
      }

      // Find raydium and meteora quotes from fetched list
      const raydiumQuote = quotes.find(q => q.dex === 'raydium') || quotes[0];
      const meteoraQuote = quotes.find(q => q.dex === 'meteora') || quotes[0];

      const diff = Math.abs(raydiumQuote.price - meteoraQuote.price);
      const avg = (raydiumQuote.price + meteoraQuote.price) / 2;
      const profitPercent = (diff / avg) * 100;

      if (profitPercent >= this.threshold) {
        return {
          tokenIn,
          tokenOut,
          raydiumPrice: raydiumQuote.price,
          meteoraPrice: meteoraQuote.price,
          priceDifference: diff,
          profitPercentage: profitPercent,
        };
      }

      return null;
    } catch (error) {
      console.error('Error during arbitrage check:', error);
      return null;
    }
  }
}
