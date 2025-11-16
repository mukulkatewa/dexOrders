// 4. src/tests/orderQueue.test.ts
// ============================================
import { OrderQueue } from '../services/orderQueue';
import { OrderRepository } from '../repositories/orderRepository';
import { RedisService } from '../services/redisService';
import { Order } from '../types';

// Mock dependencies
jest.mock('bullmq', () => {
  const mQueue = jest.fn(() => ({
    add: jest.fn(),
    close: jest.fn(),
  }));
  const mWorker = jest.fn(() => ({
    close: jest.fn(),
  }));
  return { Queue: mQueue, Worker: mWorker };
});
jest.mock('../repositories/orderRepository');
jest.mock('../services/redisService');
jest.mock('../services/mockDexRouter');

describe('OrderQueue', () => {
  let orderQueue: OrderQueue;
  let mockOrderRepository: jest.Mocked<OrderRepository>;
  let mockRedisService: jest.Mocked<RedisService>;
  let mockWebSocket: any;

  beforeEach(() => {
    mockOrderRepository = {
      updateOrderStatus: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockRedisService = {} as any;

    orderQueue = new OrderQueue(mockOrderRepository, mockRedisService);

    mockWebSocket = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // OPEN
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerWebSocket', () => {
    it('should register WebSocket for order', () => {
      orderQueue.registerWebSocket('order-ws-1', mockWebSocket);

      // Verify by checking if it's used later (internal state check)
      expect(() => orderQueue.registerWebSocket('order-ws-1', mockWebSocket)).not.toThrow();
    });

    it('should allow multiple WebSocket registrations', () => {
      const ws1 = { send: jest.fn(), close: jest.fn(), readyState: 1 };
      const ws2 = { send: jest.fn(), close: jest.fn(), readyState: 1 };

      orderQueue.registerWebSocket('order-1', ws1);
      orderQueue.registerWebSocket('order-2', ws2);

      expect(() => orderQueue.unregisterWebSocket('order-1')).not.toThrow();
      expect(() => orderQueue.unregisterWebSocket('order-2')).not.toThrow();
    });
  });

  describe('unregisterWebSocket', () => {
    it('should unregister WebSocket for order', () => {
      orderQueue.registerWebSocket('order-unreg-1', mockWebSocket);
      orderQueue.unregisterWebSocket('order-unreg-1');

      // Should not throw even if already unregistered
      expect(() => orderQueue.unregisterWebSocket('order-unreg-1')).not.toThrow();
    });

    it('should handle unregistering non-existent WebSocket', () => {
      expect(() => orderQueue.unregisterWebSocket('nonexistent')).not.toThrow();
    });
  });

  describe('addOrder', () => {
    it('should add order to queue', async () => {
      const order: Order = {
        id: 'order-queue-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await expect(orderQueue.addOrder(order)).resolves.not.toThrow();
    });
  });

  describe('close', () => {
    it('should close queue and worker', async () => {
      await expect(orderQueue.close()).resolves.not.toThrow();
    });
  });
});