import { MockDexRouter } from '../services/mockDexRouter';

describe('MockDexRouter', () => {
  let router: MockDexRouter;

  beforeEach(() => {
    router = new MockDexRouter(0, 0);
  });

  describe('getBestQuote', () => {
    it('should return a valid quote from supported DEXes', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);

      expect(quote).toHaveProperty('dex');
      expect(['raydium', 'meteora', 'orca', 'jupiter']).toContain(quote.dex);
      expect(quote).toHaveProperty('price');
      expect(quote).toHaveProperty('fee');
      expect(quote).toHaveProperty('estimatedOutput');
      expect(quote).toHaveProperty('slippage');
      expect(quote).toHaveProperty('liquidity');
      expect(quote).toHaveProperty('latencyMs');
    });

    it('should return price within expected range', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);

      expect(quote.price).toBeGreaterThan(0);
      expect(quote.price).toBeLessThan(1);
    });

    it('should calculate estimated output correctly', async () => {
      const amount = 100;
      const quote = await router.getBestQuote('SOL', 'USDC', amount);

      const expectedOutput = amount * quote.price * (1 - quote.fee - quote.slippage);
      expect(quote.estimatedOutput).toBeCloseTo(expectedOutput, 2);
    });

    it('should have a fee of 0.3%', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);

      expect(quote.fee).toBe(0.003);
    });

    it('should handle different token pairs', async () => {
      const quote1 = await router.getBestQuote('SOL', 'USDC', 50);
      const quote2 = await router.getBestQuote('ETH', 'USDT', 50);

      expect(quote1).toBeDefined();
      expect(quote2).toBeDefined();
    });

    it('should handle different amounts', async () => {
      const quote1 = await router.getBestQuote('SOL', 'USDC', 10);
      const quote2 = await router.getBestQuote('SOL', 'USDC', 1000);

      expect(quote1.estimatedOutput).toBeLessThan(quote2.estimatedOutput);
    });

    it('should include realistic market metrics', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);

      expect(quote.slippage).toBeGreaterThan(0);
      expect(quote.liquidity).toBeGreaterThan(0);
      expect(quote.latencyMs).toBeGreaterThan(0);
    });

	  describe('routing strategies', () => {
	    const baseQuotes = [
	      {
	        dex: 'raydium',
	        price: 1.0,
	        fee: 0.003,
	        estimatedOutput: 100,
	        slippage: 0.004,
	        liquidity: 1_000_000,
	        latencyMs: 120,
	      },
	      {
	        dex: 'meteora',
	        price: 1.1,
	        fee: 0.003,
	        estimatedOutput: 110,
	        slippage: 0.003,
	        liquidity: 2_000_000,
	        latencyMs: 100,
	      },
	      {
	        dex: 'orca',
	        price: 0.9,
	        fee: 0.003,
	        estimatedOutput: 90,
	        slippage: 0.001,
	        liquidity: 5_000_000,
	        latencyMs: 150,
	      },
	    ];

	    it('BEST_PRICE selects highest estimatedOutput', async () => {
	      (router as any).getQuotes = jest.fn().mockResolvedValue(baseQuotes);
	      const quote = await router.getBestQuote('SOL', 'USDC', 100, 'BEST_PRICE');
	      expect(quote.dex).toBe('meteora');
	    });

	    it('LOWEST_SLIPPAGE selects lowest slippage', async () => {
	      (router as any).getQuotes = jest.fn().mockResolvedValue(baseQuotes);
	      const quote = await router.getBestQuote('SOL', 'USDC', 100, 'LOWEST_SLIPPAGE');
	      expect(quote.dex).toBe('orca');
	    });

	    it('HIGHEST_LIQUIDITY selects highest liquidity', async () => {
	      (router as any).getQuotes = jest.fn().mockResolvedValue(baseQuotes);
	      const quote = await router.getBestQuote('SOL', 'USDC', 100, 'HIGHEST_LIQUIDITY');
	      expect(quote.dex).toBe('orca');
	    });

	    it('FASTEST_EXECUTION selects lowest latency', async () => {
	      (router as any).getQuotes = jest.fn().mockResolvedValue(baseQuotes);
	      const quote = await router.getBestQuote('SOL', 'USDC', 100, 'FASTEST_EXECUTION');
	      expect(quote.dex).toBe('meteora');
	    });
	  });
  });

  describe('executeSwap', () => {
    it('should execute swap and return valid result', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);
      const result = await router.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result).toHaveProperty('txHash');
      expect(result).toHaveProperty('executedPrice');
      expect(result).toHaveProperty('amountOut');
      expect(result).toHaveProperty('dex');
    });

    it('should return transaction hash with correct format', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);
      const result = await router.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result.txHash).toHaveLength(88);
      expect(result.txHash).toMatch(/^5[0-9a-f]{87}$/);
    });

    it('should preserve quote price in execution', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);
      const result = await router.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result.executedPrice).toBe(quote.price);
    });

    it('should preserve quote output in execution', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);
      const result = await router.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result.amountOut).toBe(quote.estimatedOutput);
    });

    it('should preserve DEX selection in execution', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);
      const result = await router.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result.dex).toBe(quote.dex);
    });

    it('should generate unique transaction hashes', async () => {
      const quote = await router.getBestQuote('SOL', 'USDC', 100);
      const result1 = await router.executeSwap(quote, 'SOL', 'USDC', 100);
      const result2 = await router.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result1.txHash).not.toBe(result2.txHash);
    });
  });
});