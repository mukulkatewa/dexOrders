import Redis from 'ioredis';
import { Order } from '../types';

export class RedisService {
  private client: Redis;
  private healthy: boolean = false;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      tls: { rejectUnauthorized: false },
    });
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
