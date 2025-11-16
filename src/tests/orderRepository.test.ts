import { Pool } from 'pg';
import { OrderRepository } from '../repositories/orderRepository';
import { Order } from '../types';

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('OrderRepository', () => {
  let repository: OrderRepository;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    mockPool = new Pool() as jest.Mocked<Pool>;
    repository = new OrderRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('should insert order into database', async () => {
      const order: Order = {
        id: 'order-create-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date('2025-01-15T10:00:00Z'),
        updatedAt: new Date('2025-01-15T10:00:00Z'),
      };

      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [], command: 'INSERT', rowCount: 1 } as any);

      await repository.createOrder(order);

      expect(mockPool.query).toHaveBeenCalledWith(
        'INSERT INTO orders (id, token_in, token_out, amount_in, order_type, status, retry_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          order.id,
          order.tokenIn,
          order.tokenOut,
          order.amountIn,
          order.orderType,
          order.status,
          order.retryCount,
          order.createdAt,
          order.updatedAt,
        ]
      );
    });

    it('should handle database errors', async () => {
      const order: Order = {
        id: 'order-error',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: 'market',
        status: 'pending',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      await expect(repository.createOrder(order)).rejects.toThrow('Database error');
    });
  });

  describe('getOrderById', () => {
    it('should return order when found', async () => {
      const dbRow = {
        id: 'order-get-1',
        token_in: 'SOL',
        token_out: 'USDC',
        amount_in: '100',
        amount_out: '4.95',
        order_type: 'market',
        status: 'confirmed',
        selected_dex: 'raydium',
        execution_price: '0.0495',
        tx_hash: '5abc123...',
        retry_count: 0,
        error_message: null,
        created_at: new Date('2025-01-15T10:00:00Z'),
        updated_at: new Date('2025-01-15T10:05:00Z'),
      };

      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [dbRow] } as any);

      const result = await repository.getOrderById('order-get-1');

      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM orders WHERE id = $1',
        ['order-get-1']
      );
      expect(result).toEqual({
        id: 'order-get-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        amountOut: 4.95,
        orderType: 'market',
        status: 'confirmed',
        selectedDex: 'raydium',
        executionPrice: 0.0495,
        txHash: '5abc123...',
        retryCount: 0,
        errorMessage: undefined,
        createdAt: dbRow.created_at,
        updatedAt: dbRow.updated_at,
      });
    });

    it('should return null when order not found', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] } as any);

      const result = await repository.getOrderById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getOrders', () => {
    it('should return paginated orders', async () => {
      const dbRows = [
        {
          id: 'order-1',
          token_in: 'SOL',
          token_out: 'USDC',
          amount_in: '100',
          amount_out: null,
          order_type: 'market',
          status: 'pending',
          selected_dex: null,
          execution_price: null,
          tx_hash: null,
          retry_count: 0,
          error_message: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'order-2',
          token_in: 'ETH',
          token_out: 'USDT',
          amount_in: '50',
          amount_out: null,
          order_type: 'market',
          status: 'routing',
          selected_dex: null,
          execution_price: null,
          tx_hash: null,
          retry_count: 0,
          error_message: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValue({ rows: dbRows } as any);

      const result = await repository.getOrders(10, 0);

      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [10, 0]
      );
      expect(result).toHaveLength(2);
    });

    it('should handle empty result set', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] } as any);

      const result = await repository.getOrders(10, 0);

      expect(result).toEqual([]);
    });
  });

  describe('updateOrder', () => {
    it('should update order with all fields', async () => {
      const order: Order = {
        id: 'order-update-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        amountOut: 4.95,
        orderType: 'market',
        status: 'confirmed',
        selectedDex: 'meteora',
        executionPrice: 0.0495,
        txHash: '5xyz789...',
        retryCount: 1,
        errorMessage: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [], command: 'UPDATE', rowCount: 1 } as any);

      await repository.updateOrder(order);

      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE orders SET status = $1, selected_dex = $2, amount_out = $3, execution_price = $4, tx_hash = $5, retry_count = $6, error_message = $7, updated_at = $8 WHERE id = $9',
        [
          order.status,
          order.selectedDex,
          order.amountOut,
          order.executionPrice,
          order.txHash,
          order.retryCount,
          order.errorMessage,
          order.updatedAt,
          order.id,
        ]
      );
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status with data', async () => {
      const data = {
        selectedDex: 'raydium',
        amountOut: 5.0,
        executedPrice: 0.05,
        txHash: '5def456...',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [], command: 'UPDATE', rowCount: 1 } as any);

      await repository.updateOrderStatus('order-status-1', 'confirmed', data);

      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE orders SET status = $1, selected_dex = $2, amount_out = $3, execution_price = $4, tx_hash = $5, updated_at = $6 WHERE id = $7',
        expect.arrayContaining([
          'confirmed',
          'raydium',
          5.0,
          0.05,
          '5def456...',
          expect.any(Date),
          'order-status-1',
        ])
      );
    });

    it('should update status without additional data', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [], command: 'UPDATE', rowCount: 1 } as any);

      await repository.updateOrderStatus('order-status-2', 'failed');

      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE orders SET status = $1, selected_dex = $2, amount_out = $3, execution_price = $4, tx_hash = $5, updated_at = $6 WHERE id = $7',
        expect.arrayContaining(['failed', undefined, undefined, undefined, undefined, expect.any(Date), 'order-status-2'])
      );
    });
  });
});