import { RedisService } from '../services/redisService';
import { Order } from '../types';

// Mock ioredis
jest.mock('ioredis', () => {
  const mRedis = {
    on: jest.fn(),
    setex: jest.fn(),
    get: jest.fn(),
    quit: jest.fn(),
  };
  return jest.fn(() => mRedis);
});

describe('RedisService', () => {
  let redisService: RedisService;
  let mockRedisClient: any;

  beforeEach(() => {
    const Redis = require('ioredis');
    redisService = new RedisService();
    mockRedisClient = Redis.mock.results[Redis.mock.results.length - 1].value;
    
    // Simulate successful connection
    const connectHandler = mockRedisClient.on.mock.calls.find(
      (call: any[]) => call[0] === 'connect'
    )?.[1];
    if (connectHandler) connectHandler();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isHealthy', () => {
    it('should return true when connected', () => {
      expect(redisService.isHealthy()).toBe(true);
    });

    it('should return false when connection error occurs', () => {
      const errorHandler = mockRedisClient.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      
      if (errorHandler) errorHandler(new Error('Connection failed'));

      expect(redisService.isHealthy()).toBe(false);
    });

    it('should return true after reconnection', () => {
      const errorHandler = mockRedisClient.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      const connectHandler = mockRedisClient.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];

      if (errorHandler) errorHandler(new Error('Connection lost'));
      expect(redisService.isHealthy()).toBe(false);

      if (connectHandler) connectHandler();
      expect(redisService.isHealthy()).toBe(true);
    });
  });

  describe('setActiveOrder', () => {
    it('should store order with correct key and TTL', async () => {
      const order: Order = {
        id: 'order-123',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisClient.setex.mockResolvedValue('OK');

      await redisService.setActiveOrder(order);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'order:order-123',
        3600,
        JSON.stringify(order)
      );
    });

    it('should handle Redis errors', async () => {
      const order: Order = {
        id: 'order-456',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisClient.setex.mockRejectedValue(new Error('Redis error'));

      await expect(redisService.setActiveOrder(order)).rejects.toThrow('Redis error');
    });
  });

  describe('getActiveOrder', () => {
    it('should retrieve and parse order correctly', async () => {
      const order: Order = {
        id: 'order-789',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'confirmed',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(order));

      const result = await redisService.getActiveOrder('order-789');

      expect(mockRedisClient.get).toHaveBeenCalledWith('order:order-789');
      expect(result).toEqual(order);
    });

    it('should return null when order not found', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await redisService.getActiveOrder('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle JSON parse errors', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json');

      await expect(redisService.getActiveOrder('order-bad')).rejects.toThrow();
    });
  });

  describe('updateActiveOrder', () => {
    it('should update order with new data', async () => {
      const order: Order = {
        id: 'order-update',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'confirmed',
        amountOut: 4.95,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisClient.setex.mockResolvedValue('OK');

      await redisService.updateActiveOrder(order);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'order:order-update',
        3600,
        JSON.stringify(order)
      );
    });
  });

  describe('close', () => {
    it('should quit Redis connection', async () => {
      mockRedisClient.quit.mockResolvedValue('OK');

      await redisService.close();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should handle quit errors', async () => {
      mockRedisClient.quit.mockRejectedValue(new Error('Quit failed'));

      await expect(redisService.close()).rejects.toThrow('Quit failed');
    });
  });
});