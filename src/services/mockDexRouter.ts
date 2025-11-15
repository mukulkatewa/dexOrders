export interface DexQuote {
  dex: string;
  price: number;
  fee: number;
  estimatedOutput: number;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  amountOut: number;
  dex: string;
}

export class MockDexRouter {
  async getBestQuote(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote> {
    await new Promise(resolve => setTimeout(resolve, 200));
    const price = 0.05 * (0.98 + Math.random() * 0.04);
    return {
      dex: Math.random() > 0.5 ? 'raydium' : 'meteora',
      price,
      fee: 0.003,
      estimatedOutput: amount * price * 0.997,
    };
  }

  async executeSwap(quote: DexQuote, tokenIn: string, tokenOut: string, amount: number): Promise<SwapResult> {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const txHash = '5' + Array.from({ length: 87 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return {
      txHash,
      executedPrice: quote.price,
      amountOut: quote.estimatedOutput,
      dex: quote.dex,
    };
  }
}
