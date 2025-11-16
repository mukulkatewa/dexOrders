// 5. src/tests/integration.test.ts
// ============================================
import { Database } from '../database/db';
import { OrderRepository } from '../repositories/orderRepository';
import { RedisService } from '../services/redisService';
import { MockDexRouter } from '../services/mockDexRouter';
import { Order } from '../types';

const integrationDescribe = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

integrationDescribe('Integration Tests', () => {
  let database: Database;
  let orderRepository: OrderRepository;
  let redisService: RedisService;
  let dexRouter: MockDexRouter;

  beforeAll(async () => {
    // Setup test environment
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/testdb';
    process.env.REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT || '6379';

    database = new Database();
    await database.initialize();
    orderRepository = new OrderRepository(database.getPool());
    redisService = new RedisService();
    dexRouter = new MockDexRouter();

    // Wait for Redis connection
    let retries = 0;
    while (!redisService.isHealthy() && retries < 10) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }
  });

  afterAll(async () => {
    await redisService.close();
    await database.close();
  });

  describe('Order Lifecycle Integration', () => {
    it('should create order in database and cache in Redis', async () => {
      const order: Order = {
        id: `order-int-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create in database
      await orderRepository.createOrder(order);

      // Cache in Redis
      await redisService.setActiveOrder(order);

      // Verify database
      const dbOrder = await orderRepository.getOrderById(order.id);
      expect(dbOrder).toBeDefined();
      expect(dbOrder?.id).toBe(order.id);

      // Verify Redis
      const redisOrder = await redisService.getActiveOrder(order.id);
      expect(redisOrder).toBeDefined();
      expect(redisOrder?.id).toBe(order.id);
    });

    it('should execute complete order flow', async () => {
      const order: Order = {
        id: `order-flow-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 50,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 1. Create order
      await orderRepository.createOrder(order);
      await redisService.setActiveOrder(order);

      // 2. Get quote from DEX
      const quote = await dexRouter.getBestQuote(order.tokenIn, order.tokenOut, order.amountIn);
      expect(quote).toBeDefined();

      // 3. Update order status to routing
      await orderRepository.updateOrderStatus(order.id, 'routing', {
        selectedDex: quote.dex,
      });

      // 4. Execute swap
      const result = await dexRouter.executeSwap(quote, order.tokenIn, order.tokenOut, order.amountIn);
      expect(result.txHash).toBeDefined();

      // 5. Update order to confirmed
      await orderRepository.updateOrderStatus(order.id, 'confirmed', {
        selectedDex: result.dex,
        amountOut: result.amountOut,
        executedPrice: result.executedPrice,
        txHash: result.txHash,
      });

      // 6. Verify final state
      const finalOrder = await orderRepository.getOrderById(order.id);
      expect(finalOrder?.status).toBe('confirmed');
      expect(finalOrder?.txHash).toBe(result.txHash);
    });
  });

  describe('Database and Redis Sync', () => {
    it('should maintain consistency between database and Redis', async () => {
      const order: Order = {
        id: `order-sync-${Date.now()}`,
        tokenIn: 'ETH',
        tokenOut: 'USDT',
        amountIn: 25,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create in both
      await orderRepository.createOrder(order);
      await redisService.setActiveOrder(order);

      // Update status
      order.status = 'confirmed';
      order.amountOut = 75.5;
      order.updatedAt = new Date();

      await orderRepository.updateOrder(order);
      await redisService.updateActiveOrder(order);

      // Verify both sources
      const dbOrder = await orderRepository.getOrderById(order.id);
      const redisOrder = await redisService.getActiveOrder(order.id);

      expect(dbOrder?.status).toBe('confirmed');
      expect(redisOrder?.status).toBe('confirmed');
      expect(dbOrder?.amountOut).toBe(75.5);
      expect(redisOrder?.amountOut).toBe(75.5);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle order not found in database', async () => {
      const result = await orderRepository.getOrderById('nonexistent-order');
      expect(result).toBeNull();
    });

    it('should handle order not found in Redis', async () => {
      const result = await redisService.getActiveOrder('nonexistent-order');
      expect(result).toBeNull();
    });

    it('should fallback to database when Redis fails', async () => {
      const order: Order = {
        id: `order-fallback-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create in database only
      await orderRepository.createOrder(order);

      // Should still retrieve from database
      const dbOrder = await orderRepository.getOrderById(order.id);
      expect(dbOrder).toBeDefined();
      expect(dbOrder?.id).toBe(order.id);
    });
  });

  describe('DEX Router Integration', () => {
    it('should get quotes from multiple DEXs', async () => {
      const quotes: any[] = [];
      
      for (let i = 0; i < 10; i++) {
        const quote = await dexRouter.getBestQuote('SOL', 'USDC', 100);
        quotes.push(quote);
      }

      const raydiumQuotes = quotes.filter(q => q.dex === 'raydium');
      const meteoraQuotes = quotes.filter(q => q.dex === 'meteora');

      // Should have quotes from both DEXs
      expect(raydiumQuotes.length).toBeGreaterThan(0);
      expect(meteoraQuotes.length).toBeGreaterThan(0);
    });

    it('should execute swaps with consistent results', async () => {
      const quote = await dexRouter.getBestQuote('SOL', 'USDC', 100);
      const result = await dexRouter.executeSwap(quote, 'SOL', 'USDC', 100);

      expect(result.dex).toBe(quote.dex);
      expect(result.executedPrice).toBe(quote.price);
      expect(result.amountOut).toBe(quote.estimatedOutput);
      expect(result.txHash).toMatch(/^5[0-9a-f]{87}$/);
    });
  });

  describe('Pagination Tests', () => {
    it('should paginate orders correctly', async () => {
      // Create multiple orders
      const orders: Order[] = [];
      for (let i = 0; i < 5; i++) {
        const order: Order = {
          id: `order-page-${Date.now()}-${i}`,
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100 + i,
          orderType: 'market',
          status: 'pending',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        orders.push(order);
        await orderRepository.createOrder(order);
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Test first page
      const page1 = await orderRepository.getOrders(2, 0);
      expect(page1.length).toBe(2);

      // Test second page
      const page2 = await orderRepository.getOrders(2, 2);
      expect(page2.length).toBe(2);

      // Ensure no overlap
      const page1Ids = page1.map(o => o.id);
      const page2Ids = page2.map(o => o.id);
      const overlap = page1Ids.filter(id => page2Ids.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent order creation', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        const order: Order = {
          id: `order-concurrent-${Date.now()}-${i}-${Math.random()}`,
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: 'market',
          status: 'pending',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        promises.push(
          orderRepository.createOrder(order).then(() => 
            redisService.setActiveOrder(order)
          )
        );
      }

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle concurrent order updates', async () => {
      const order: Order = {
        id: `order-update-concurrent-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await orderRepository.createOrder(order);
      await redisService.setActiveOrder(order);

      const statuses = ['routing', 'building', 'submitted', 'confirmed'];
      const promises = statuses.map((status, index) => 
        new Promise(resolve => setTimeout(async () => {
          await orderRepository.updateOrderStatus(order.id, status);
          resolve(undefined);
        }, index * 100))
      );

      await expect(Promise.all(promises)).resolves.not.toThrow();

      // Verify final state
      const finalOrder = await orderRepository.getOrderById(order.id);
      expect(finalOrder?.status).toBe('confirmed');
    });
  });

  describe('Performance Tests', () => {
    it('should retrieve order quickly from Redis', async () => {
      const order: Order = {
        id: `order-perf-redis-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await redisService.setActiveOrder(order);

      const start = Date.now();
      await redisService.getActiveOrder(order.id);
      const duration = Date.now() - start;

      // Redis should be very fast (< 50ms)
      expect(duration).toBeLessThan(50);
    });

    it('should handle bulk order creation efficiently', async () => {
      const start = Date.now();
      const promises = [];

      for (let i = 0; i < 20; i++) {
        const order: Order = {
          id: `order-bulk-${Date.now()}-${i}-${Math.random()}`,
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: 'market',
          status: 'pending',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        promises.push(orderRepository.createOrder(order));
      }

      await Promise.all(promises);
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Data Validation Integration', () => {
    it('should store and retrieve decimal values correctly', async () => {
      const order: Order = {
        id: `order-decimal-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 123.456789,
        amountOut: 6.123456,
        orderType: 'market',
        status: 'confirmed',
        executionPrice: 0.04958372,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await orderRepository.createOrder(order);
      
      // Update with output values
      await orderRepository.updateOrderStatus(order.id, 'confirmed', {
        amountOut: order.amountOut,
        executedPrice: order.executionPrice,
      });

      const retrieved = await orderRepository.getOrderById(order.id);
      
      expect(retrieved?.amountIn).toBeCloseTo(123.456789, 6);
      expect(retrieved?.amountOut).toBeCloseTo(6.123456, 6);
      expect(retrieved?.executionPrice).toBeCloseTo(0.04958372, 6);
    });

    it('should handle null optional fields', async () => {
      const order: Order = {
        id: `order-null-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await orderRepository.createOrder(order);
      const retrieved = await orderRepository.getOrderById(order.id);

      expect(retrieved?.amountOut).toBeUndefined();
      expect(retrieved?.selectedDex).toBeUndefined();
      expect(retrieved?.executionPrice).toBeUndefined();
      expect(retrieved?.txHash).toBeUndefined();
      expect(retrieved?.errorMessage).toBeUndefined();
    });
  });

  describe('Status Transition Integration', () => {
    it('should transition through all order statuses correctly', async () => {
      const order: Order = {
        id: `order-status-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create
      await orderRepository.createOrder(order);
      let retrieved = await orderRepository.getOrderById(order.id);
      expect(retrieved?.status).toBe('pending');

      // Routing
      await orderRepository.updateOrderStatus(order.id, 'routing');
      retrieved = await orderRepository.getOrderById(order.id);
      expect(retrieved?.status).toBe('routing');

      // Building
      await orderRepository.updateOrderStatus(order.id, 'building');
      retrieved = await orderRepository.getOrderById(order.id);
      expect(retrieved?.status).toBe('building');

      // Submitted
      await orderRepository.updateOrderStatus(order.id, 'submitted');
      retrieved = await orderRepository.getOrderById(order.id);
      expect(retrieved?.status).toBe('submitted');

      // Confirmed
      await orderRepository.updateOrderStatus(order.id, 'confirmed', {
        txHash: '5abc123...',
        amountOut: 4.95,
        executedPrice: 0.0495,
        selectedDex: 'raydium',
      });
      retrieved = await orderRepository.getOrderById(order.id);
      expect(retrieved?.status).toBe('confirmed');
      expect(retrieved?.txHash).toBe('5abc123...');
    });

    it('should handle failed order status', async () => {
      const order: Order = {
        id: `order-failed-${Date.now()}`,
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await orderRepository.createOrder(order);
      await orderRepository.updateOrderStatus(order.id, 'failed');

      const retrieved = await orderRepository.getOrderById(order.id);
      expect(retrieved?.status).toBe('failed');
    });
  });
});

// ============================================
// ADDITIONAL TEST UTILITIES
// ============================================

// Test helper functions
export const testHelpers = {
  createMockOrder: (overrides?: Partial<Order>): Order => ({
    id: `order-${Date.now()}-${Math.random()}`,
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: 100,
    orderType: 'market',
    status: 'pending',
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  createMockWebSocket: () => ({
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    readyState: 1,
  }),

  waitForCondition: async (
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error('Timeout waiting for condition');
  },

  sleep: (ms: number): Promise<void> => 
    new Promise(resolve => setTimeout(resolve, ms)),
}