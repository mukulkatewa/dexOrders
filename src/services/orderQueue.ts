import { Queue, Worker } from 'bullmq';
import { Order } from '../types';
import { OrderRepository } from '../repositories/orderRepository';
import { RedisService } from './redisService';
import { MockDexRouter } from './mockDexRouter';

export class OrderQueue {
  private queue: Queue;
  private worker: Worker;
  private dexRouter: MockDexRouter;
  private webSockets: Map<string, any> = new Map();

  constructor(private orderRepository: OrderRepository, private redisService: RedisService) {
    const connection = {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      tls: { rejectUnauthorized: false },
    };
    this.queue = new Queue('orders', { connection });
    this.dexRouter = new MockDexRouter();
    this.worker = new Worker('orders', async (job) => {
      await this.processOrder(job.data);
    }, { connection });
  }

  registerWebSocket(orderId: string, ws: any): void {
    this.webSockets.set(orderId, ws);
  }

  unregisterWebSocket(orderId: string): void {
    this.webSockets.delete(orderId);
  }

  async addOrder(order: Order): Promise<void> {
    await this.queue.add('process', order);
  }

  private async processOrder(order: Order): Promise<void> {
    const ws = this.webSockets.get(order.id);
    try {
      if (ws) {
        ws.send(JSON.stringify({
          orderId: order.id,
          status: 'routing',
          message: 'Comparing DEX prices',
          timestamp: Date.now(),
        }));
      }

      const quote = await this.dexRouter.getBestQuote(order.tokenIn, order.tokenOut, order.amountIn);

      if (ws) {
        ws.send(JSON.stringify({
          orderId: order.id,
          status: 'routing',
          message: `Selected ${quote.dex}`,
          data: { selectedDex: quote.dex, estimatedOutput: quote.estimatedOutput },
          timestamp: Date.now(),
        }));
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      if (ws) {
        ws.send(JSON.stringify({
          orderId: order.id,
          status: 'building',
          message: 'Creating transaction',
          timestamp: Date.now(),
        }));
      }

      // Transaction is being sent to the network
      if (ws) {
        ws.send(JSON.stringify({
          orderId: order.id,
          status: 'submitted',
          message: 'Transaction sent to network',
          timestamp: Date.now(),
        }));
      }

      await this.orderRepository.updateOrderStatus(order.id, 'submitted', {
        selectedDex: quote.dex,
        amountOut: quote.estimatedOutput,
        executedPrice: quote.price,
      });

      const result = await this.dexRouter.executeSwap(quote, order.tokenIn, order.tokenOut, order.amountIn);

      await this.orderRepository.updateOrderStatus(order.id, 'confirmed', {
        selectedDex: result.dex,
        amountOut: result.amountOut,
        executedPrice: result.executedPrice,
        txHash: result.txHash,
      });

      if (ws) {
        ws.send(JSON.stringify({
          orderId: order.id,
          status: 'confirmed',
          message: 'Transaction successful',
          data: {
            txHash: result.txHash,
            executedPrice: result.executedPrice,
            amountOut: result.amountOut,
            selectedDex: result.dex,
          },
          timestamp: Date.now(),
        }));
        ws.close();
      }

      this.unregisterWebSocket(order.id);
    } catch (error) {
      if (ws) {
        ws.send(JSON.stringify({
          orderId: order.id,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Failed',
          timestamp: Date.now(),
        }));
      }

      await this.orderRepository.updateOrderStatus(order.id, 'failed');
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
