import { Pool } from 'pg';
import { Order } from '../types';

export class OrderRepository {
  constructor(private pool: Pool) {}

  async createOrder(order: Order): Promise<void> {
    await this.pool.query(
      'INSERT INTO orders (id, token_in, token_out, amount_in, order_type, status, retry_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [order.id, order.tokenIn, order.tokenOut, order.amountIn, order.orderType, order.status, order.retryCount, order.createdAt, order.updatedAt]
    );
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const result = await this.pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async getOrders(limit: number, offset: number): Promise<Order[]> {
    const result = await this.pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows.map(r => this.mapRow(r));
  }

  async updateOrder(order: Order): Promise<void> {
    await this.pool.query(
      'UPDATE orders SET status = $1, selected_dex = $2, amount_out = $3, execution_price = $4, tx_hash = $5, retry_count = $6, error_message = $7, updated_at = $8 WHERE id = $9',
      [order.status, order.selectedDex, order.amountOut, order.executionPrice, order.txHash, order.retryCount, order.errorMessage, order.updatedAt, order.id]
    );
  }

  async updateOrderStatus(orderId: string, status: string, data?: any): Promise<void> {
    await this.pool.query(
      'UPDATE orders SET status = $1, selected_dex = $2, amount_out = $3, execution_price = $4, tx_hash = $5, updated_at = $6 WHERE id = $7',
      [status, data?.selectedDex, data?.amountOut, data?.executedPrice, data?.txHash, new Date(), orderId]
    );
  }

  private mapRow(row: any): Order {
    return {
      id: row.id,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amountIn: parseFloat(row.amount_in),
      amountOut: row.amount_out ? parseFloat(row.amount_out) : undefined,
      orderType: row.order_type,
      status: row.status,
      selectedDex: row.selected_dex,
      executionPrice: row.execution_price ? parseFloat(row.execution_price) : undefined,
      txHash: row.tx_hash,
      retryCount: row.retry_count,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
