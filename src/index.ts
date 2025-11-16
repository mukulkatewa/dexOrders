/**
 * ORDER EXECUTION ENGINE - Main Server
 * Fastify + TypeScript + PostgreSQL + Redis + BullMQ
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables first
const pathqwqw = dotenv.config({ path: path.resolve(__dirname, '../.env') });
console.log("check check:",pathqwqw);


console.log('🔍 Starting application...');
console.log('📋 Environment check:');
console.log('  DATABASE_URL:', process.env.DATABASE_URL ? '✅ Loaded' : '❌ Missing');
console.log('  REDIS_HOST:', process.env.REDIS_HOST || '❌ Missing');
console.log('  PORT:', process.env.PORT || '3000');

// Import dependencies
import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import cors from '@fastify/cors';
import { v4 as uuidv4 } from 'uuid';
import { Database } from './database/db';
import { OrderRepository } from './repositories/orderRepository';
import { RedisService } from './services/redisService';
import { OrderQueue } from './services/orderQueue';
import { Order, OrderRequest } from './types';
import { errorHandler } from './services/errorHandler';
import { ValidationError, NotFoundError } from './errors/customErrors';
import { BotManager } from './bots/botManager';
import { ArbitrageBot } from './bots/arbitrageBot';
import { BotConfig } from './bots/autoTradingBot';



console.log('✅ All imports loaded successfully');

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

const botManager = new BotManager();
const arbitrageBot = new ArbitrageBot(0.02);

// Global service instances
let database: Database;
let orderRepository: OrderRepository;
let redisService: RedisService;
let orderQueue: OrderQueue;

/**
 * Validate incoming order requests
 */
function validateOrderRequest(body: any): asserts body is OrderRequest {
  if (!body) {
    throw new ValidationError('Request body is required');
  }

  if (!body.tokenIn || typeof body.tokenIn !== 'string') {
    throw new ValidationError('tokenIn is required and must be a string');
  }

  if (!body.tokenOut || typeof body.tokenOut !== 'string') {
    throw new ValidationError('tokenOut is required and must be a string');
  }

  if (body.tokenIn === body.tokenOut) {
    throw new ValidationError('tokenIn and tokenOut must be different');
  }

  if (typeof body.amountIn !== 'number' || body.amountIn <= 0) {
    throw new ValidationError('amountIn must be a positive number');
  }

  if (body.amountIn > 1000000) {
    throw new ValidationError('amountIn exceeds maximum (1,000,000)');
  }

  if (body.slippage !== undefined) {
    if (typeof body.slippage !== 'number' || body.slippage < 0 || body.slippage > 0.5) {
      throw new ValidationError('slippage must be between 0 and 0.5');
    }
  }
}

/**
 * Initialize backend services
 */
async function initializeServices() {
  try {
    console.log('🔧 Initializing services...');

    console.log('  📊 Initializing database...');
    database = new Database();
    await database.initialize();
    orderRepository = new OrderRepository(database.getPool());
    console.log('  ✅ Database ready');

    console.log('  📦 Initializing Redis...');
    redisService = new RedisService();

    let retries = 0;
    while (!redisService.isHealthy() && retries < 10) {
      console.log(`  ⏳ Waiting for Redis... (${retries + 1}/10)`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries++;
    }

    if (!redisService.isHealthy()) {
      throw new Error('Redis failed to connect after 10 retries');
    }
    console.log('  ✅ Redis ready');

    console.log('  📋 Initializing order queue...');
    orderQueue = new OrderQueue(orderRepository, redisService);
    console.log('  ✅ Order queue ready');

    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Service initialization failed:', error);
    throw error;
  }
}

/**
 * Register Fastify plugins
 */
async function registerPlugins() {
  try {
    console.log('🔌 Registering plugins...');
    
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });
    console.log('  ✅ CORS registered');

    await fastify.register(websocketPlugin);
    console.log('  ✅ WebSocket registered');

    console.log('✅ Plugins registered successfully');
  } catch (error) {
    console.error('❌ Plugin registration failed:', error);
    throw error;
  }
}

/**
 * Start server and register all routes
 */
async function start() {
  console.log('\n🚀 Starting server...\n');
  
  try {
    await initializeServices();
    await registerPlugins();

    // ENDPOINT 1: Health Check
    fastify.get('/health', async (request, reply) => {
      try {
        const dbHealthy = await database.healthCheck().catch(() => false);
        const redisHealthy = redisService.isHealthy();
        
        const response = {
          status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealthy ? 'up' : 'down',
            redis: redisHealthy ? 'up' : 'down',
          },
        };
        
        reply.raw.writeHead(200, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify(response));
        return reply;
      } catch (error) {
        const errorResponse = {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          services: { database: 'down', redis: 'down' },
        };
        reply.raw.writeHead(503, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify(errorResponse));
        return reply;
      }
    });

    // ENDPOINT 2: Get All Orders
    fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
      '/api/orders',
      async (request, reply) => {
        try {
          const limit = Math.min(parseInt(request.query.limit || '50'), 1000);
          const offset = Math.max(parseInt(request.query.offset || '0'), 0);

          const orders = await orderRepository.getOrders(limit, offset);

          return {
            orders,
            pagination: {
              limit,
              offset,
              count: orders.length,
            },
          };
        } catch (error) {
          throw error;
        }
      }
    );

    // ENDPOINT 3: Get Single Order by ID
    fastify.get<{ Params: { orderId: string } }>(
      '/api/orders/:orderId',
      async (request, reply) => {
        try {
          const { orderId } = request.params;

          if (!orderId || orderId.trim() === '') {
            throw new ValidationError('orderId is required');
          }

          let order = await redisService.getActiveOrder(orderId);

          if (!order) {
            order = await orderRepository.getOrderById(orderId);
          }

          if (!order) {
            throw new NotFoundError('Order', orderId);
          }

          return order;
        } catch (error) {
          throw error;
        }
      }
    );

    // ENDPOINT 4: Order Execution - POST creates order and returns orderId
    fastify.post<{ Body: OrderRequest }>('/api/orders/execute', async (request, reply) => {
      try {
        const body = request.body;
        validateOrderRequest(body);

        const order: Order = {
          id: uuidv4(),
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amountIn: body.amountIn,
          orderType: body.orderType || 'market',
          status: 'pending',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await orderRepository.createOrder(order);
        await redisService.setActiveOrder(order);

        return {
          orderId: order.id,
          status: 'pending',
          message: 'Order created. Connect to WebSocket for real-time updates.',
          websocketUrl: `/api/orders/execute?orderId=${order.id}`,
        };
      } catch (error) {
        throw error;
      }
    });

    // ENDPOINT 5: WebSocket for Order Execution - client connects with orderId
    fastify.register(async function (fastifyInstance) {
      fastifyInstance.get('/api/orders/execute', { websocket: true }, (socket: any, request: any) => {
        const ws = socket;
        console.log('🔌 WebSocket client connected');

        const query = (request.query || {}) as { orderId?: string };
        const orderId = query.orderId;

        if (!orderId) {
          ws.send(JSON.stringify({
            status: 'error',
            message: 'orderId query parameter is required',
            timestamp: Date.now(),
          }));
          ws.close();
          return;
        }

        (async () => {
          try {
            let order =
              (await redisService.getActiveOrder(orderId)) ||
              (await orderRepository.getOrderById(orderId));

            if (!order) {
              ws.send(JSON.stringify({
                orderId,
                status: 'error',
                message: 'Order not found',
                timestamp: Date.now(),
              }));
              ws.close();
              return;
            }

            ws.send(JSON.stringify({
              orderId: order.id,
              status: 'pending',
              message: 'Order received and queued for execution',
              timestamp: Date.now(),
            }));

            orderQueue.registerWebSocket(order.id, ws);
            await orderQueue.addOrder(order);

            console.log(`📝 Order ${order.id} queued for execution`);
          } catch (error) {
            console.error('❌ WebSocket error:', error);
            errorHandler.handleWebSocketError(
              error instanceof Error ? error : new Error(String(error)),
              ws,
              orderId
            );
            ws.close();
          }
        })();

        ws.on('close', () => {
          console.log(`🔌 WebSocket disconnected for order ${orderId}`);
          orderQueue.unregisterWebSocket(orderId);
        });

        ws.on('error', (error: any) => {
          console.error('❌ WebSocket error:', error);
        });
      });
    });

    // --- NEW BOT API ENDPOINTS ---

    // POST /api/bots/start - Start an Auto-Trading Bot with config
    interface BotStartRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  triggerCondition: 'below' | 'above';
  targetPrice: number;
}
    fastify.post<{ Body: BotStartRequest }>('/api/bots/start', async (request, reply) => {
      try {
        console.log('Registering bot API routes...');

        const { tokenIn, tokenOut, amountIn, triggerCondition, targetPrice } = request.body;

        // Basic validation
        if (!tokenIn || !tokenOut || !amountIn || !triggerCondition || !targetPrice) {
          return reply.status(400).send({ error: 'Missing required bot config parameters' });
        }

        const botConfig: BotConfig = {
          id: uuidv4(),
          tokenIn,
          tokenOut,
          amountIn,
          triggerCondition,
          targetPrice,
        };

        await botManager.startBot(botConfig);

        return { success: true, botId: botConfig.id, message: 'Auto-trading bot started' };
      } catch (error) {
        console.error('Failed to start bot:', error);
        return reply.status(500).send({ error: 'Failed to start bot' });
      }
    });

    // POST /api/bots/stop - Stop an Auto-Trading Bot by botId
    fastify.post<{ Body: { botId: string } }>('/api/bots/stop', async (request, reply) => {
      try {
        const { botId } = request.body;

        if (!botId) {
          return reply.status(400).send({ error: 'botId is required' });
        }

        botManager.stopBot(botId);

        return { success: true, message: 'Auto-trading bot stopped' };
      } catch (error) {
        console.error('Failed to stop bot:', error);
        return reply.status(500).send({ error: 'Failed to stop bot' });
      }
    });

    // GET /api/bots/active - List count of currently active Auto-Trading Bots
    fastify.get('/api/bots/active', async (_request, reply) => {
      try {
        const count = botManager.getActiveBotsCount();
        return { activeBotsCount: count };
      } catch (error) {
        console.error('Failed to get active bot count:', error);
        return reply.status(500).send({ error: 'Failed to get active bot count' });
      }
    });

    // GET /api/arbitrage/check?tokenIn=&tokenOut=&amount=
    // Check arbitrage price difference between Raydium and Meteora
    fastify.get<{ Querystring: { tokenIn: string; tokenOut: string; amount: string } }>(
      '/api/arbitrage/check',
      async (request, reply) => {
        try {
          const { tokenIn, tokenOut, amount } = request.query;

          if (!tokenIn || !tokenOut || !amount) {
            return reply.status(400).send({ error: 'tokenIn, tokenOut and amount query params required' });
          }

          const result = await arbitrageBot.checkArbitrage(
            tokenIn,
            tokenOut,
            parseFloat(amount)
          );

          return result || { message: 'No arbitrage opportunity detected' };
        } catch (error) {
          console.error('Arbitrage check error:', error);
          return reply.status(500).send({ error: 'Failed to check arbitrage' });
        }
      }
    );

    // Global error handler
    fastify.setErrorHandler(async (error, request, reply) => {
      const errorInstance = error instanceof Error 
        ? error 
        : new Error(String(error));
      
      await errorHandler.handleError(errorInstance, request, reply);
    });

    // Start HTTP server
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    console.log(`\n✅ Server running at http://localhost:${port}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${port}/api/orders/execute`);
    console.log('\n📋 Available endpoints:');
    console.log(`   GET  /health`);
    console.log(`   GET  /api/orders`);
    console.log(`   GET  /api/orders/:orderId`);
    console.log(`   WS   /api/orders/execute (WebSocket)\n`);
  } catch (error) {
    console.error('\n❌ Server startup error:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string) {
  console.log(`\n⏹️  Received ${signal}, shutting down gracefully...`);

  try {
    if (orderQueue) {
      console.log('  Closing order queue...');
      await orderQueue.close();
    }

    if (redisService) {
      console.log('  Closing Redis connection...');
      await redisService.close();
    }

    if (database) {
      console.log('  Closing database connection...');
      await database.close();
    }

    console.log('  Closing Fastify server...');
    await fastify.close();

    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection:', reason);
  errorHandler.handleUnhandledRejection(reason, promise);
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  errorHandler.handleUncaughtException(error);
});

// Graceful shutdown listeners
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the application
console.log('🎬 Calling start() function...');
start().catch((error) => {
  console.error('🚨 Fatal error during startup:', error);
  process.exit(1);
});
