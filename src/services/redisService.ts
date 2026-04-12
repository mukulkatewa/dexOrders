import Redis from 'ioredis';
import { Order } from '../types';

export class RedisService {
  private client: Redis;
  private healthy: boolean = false;

  constructor() {
    const opts: any = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    };
    if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
    if (process.env.REDIS_TLS === 'true') {
      opts.tls = { rejectUnauthorized: false };
    }
    this.client = new Redis(opts);
    this.client.on('connect', () => {
      this.healthy = true;
    });
    this.client.on('error', () => {
      this.healthy = false;
    });
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async setActiveOrder(order: Order): Promise<void> {
    await this.client.setex(`order:${order.id}`, 3600, JSON.stringify(order));
  }

  async getActiveOrder(orderId: string): Promise<Order | null> {
    const data = await this.client.get(`order:${orderId}`);
    if (!data) return null;
    
    const order = JSON.parse(data);
    // Convert date strings back to Date objects
    return {
      ...order,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt),
    };
  }

  async updateActiveOrder(order: Order): Promise<void> {
    await this.client.setex(`order:${order.id}`, 3600, JSON.stringify(order));
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
