import { MockDexRouter } from "../services/mockDexRouter";

// Interface for arbitrage opportunity details
export interface ArbitrageOpportunity {
  tokenIn: string;
  tokenOut: string;
  raydiumPrice: number;
  meteoraPrice: number;
  priceDifference: number;
  profitPercentage: number;
  // Realistic arbitrage details
  buyDex: string; // DEX with lowest price (where to buy)
  sellDex: string; // DEX with highest price (where to sell)
  buyPrice: number;
  sellPrice: number;
  allPrices: {
    raydium: number;
    meteora: number;
    orca: number;
    jupiter: number;
  };
}

// Bot to detect arbitrage opportunities between two DEXs
export class ArbitrageBot {
  private router = new MockDexRouter();
  private threshold: number;

  // threshold percentage for arbitrage alert (default 2%)
  constructor(thresholdPercent = 2) {
    this.threshold = thresholdPercent;
  }

  /**
   * Detect arbitrage opportunities by comparing prices across all DEXs
   *
   * Realistic approach:
   * - Pools are initialized with similar prices (0.5-1.5% variance)
   * - Real arbitrage opportunities are typically 0.1-2% profit
   * - Returns detailed information about which DEXs offer best buy/sell prices
   *
   * @param tokenIn - Input token symbol
   * @param tokenOut - Output token symbol
   * @param amountIn - Amount to swap
   * @param threshold - Minimum profit percentage to consider (default: uses constructor threshold)
   * @returns ArbitrageOpportunity with buy/sell DEX details, or null if no opportunity
   */
  async checkArbitrage(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    threshold?: number
  ): Promise<ArbitrageOpportunity | null> {
    try {
      const effectiveThreshold = threshold ?? this.threshold;

      // Fetch quotes directly from each DEX using individual methods (uses AMM pools)
      const [raydiumQuote, meteoraQuote, orcaQuote, jupiterQuote] =
        await Promise.all([
          this.router.getRaydiumQuote(tokenIn, tokenOut, amountIn),
          this.router.getMeteoraQuote(tokenIn, tokenOut, amountIn),
          this.router.getOrcaQuote(tokenIn, tokenOut, amountIn),
          this.router.getJupiterQuote(tokenIn, tokenOut, amountIn),
        ]);

      // Find the best buy price (lowest) and best sell price (highest)
      const allQuotes = [
        { dex: "raydium", quote: raydiumQuote },
        { dex: "meteora", quote: meteoraQuote },
        { dex: "orca", quote: orcaQuote },
        { dex: "jupiter", quote: jupiterQuote },
      ];

      // Sort by price (ascending = buy, descending = sell)
      const sortedByPrice = [...allQuotes].sort(
        (a, b) => a.quote.price - b.quote.price
      );
      const lowestPrice = sortedByPrice[0];
      const highestPrice = sortedByPrice[sortedByPrice.length - 1];

      // Calculate profit percentage
      const priceDiff = highestPrice.quote.price - lowestPrice.quote.price;
      const avgPrice = (lowestPrice.quote.price + highestPrice.quote.price) / 2;
      const profitPercent = (priceDiff / avgPrice) * 100;

      // Debug logging (can be removed in production)
      console.log(
        `[ArbitrageBot] Price check: ${
          lowestPrice.dex
        }=${lowestPrice.quote.price.toFixed(6)}, ${
          highestPrice.dex
        }=${highestPrice.quote.price.toFixed(6)}, diff=${profitPercent.toFixed(
          3
        )}%, threshold=${effectiveThreshold}%`
      );

      // Check if profit exceeds threshold
      if (profitPercent >= effectiveThreshold) {
        return {
          tokenIn,
          tokenOut,
          raydiumPrice: raydiumQuote.price,
          meteoraPrice: meteoraQuote.price,
          priceDifference: priceDiff,
          profitPercentage: profitPercent,
          // Realistic arbitrage details
          buyDex: lowestPrice.dex,
          sellDex: highestPrice.dex,
          buyPrice: lowestPrice.quote.price,
          sellPrice: highestPrice.quote.price,
          allPrices: {
            raydium: raydiumQuote.price,
            meteora: meteoraQuote.price,
            orca: orcaQuote.price,
            jupiter: jupiterQuote.price,
          },
        };
      }

      return null;
    } catch (error) {
      console.error("Error during arbitrage check:", error);
      return null;
    }
  }
}
