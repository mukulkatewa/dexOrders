/**
 * ORDER EXECUTION ENGINE - Main Server
 * Fastify + TypeScript + PostgreSQL + Redis + BullMQ
 * PHASE 3: Added RoutingHub with Intelligent Tuple-Based DEX Selection
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables first
const pathqwqw = dotenv.config({ path: path.resolve(__dirname, '../.env') });
console.log("check check:", pathqwqw);

console.log('Starting application...');
console.log('Environment check:');
console.log('  DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Missing');
console.log('  REDIS_HOST:', process.env.REDIS_HOST || 'Missing');
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
import { Order, OrderRequest, RoutingStrategy } from './types';
import { errorHandler } from './services/errorHandler';
import { ValidationError, NotFoundError } from './errors/customErrors';
import { BotManager } from './bots/botManager';
import { ArbitrageBot } from './bots/arbitrageBot';
import { BotConfig } from './bots/autoTradingBot';
import { MockDexRouter } from './services/mockDexRouter';

// PHASE 1, 2 & 3: Import worker, scheduler, and routing hub
import { DexWorker } from './workers/dexWorker';
import { JobScheduler } from './services/jobScheduler';

console.log('All imports loaded successfully');

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

const botManager = new BotManager();
const arbitrageBot = new ArbitrageBot(0.02);
const httpDexRouter = new MockDexRouter();

// Global service instances
let database: Database;
let orderRepository: OrderRepository;
let redisService: RedisService;
let orderQueue: OrderQueue;

// PHASE 1: Global DEX workers array
let dexWorkers: DexWorker[] = [];

// PHASE 2 & 3: Global job scheduler (includes RoutingHub)
let jobScheduler: JobScheduler;

const ROUTING_STRATEGIES: RoutingStrategy[] = [
  'BEST_PRICE',
  'LOWEST_SLIPPAGE',
  'HIGHEST_LIQUIDITY',
  'FASTEST_EXECUTION',
];

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

  if (body.routingStrategy !== undefined) {
    if (!ROUTING_STRATEGIES.includes(body.routingStrategy)) {
      throw new ValidationError('routingStrategy is invalid');
    }
  }
}

/**
 * Initialize backend services
 */
async function initializeServices() {
  try {
    console.log('Initializing services...');

    console.log('  Initializing database...');
    database = new Database();
    await database.initialize();
    orderRepository = new OrderRepository(database.getPool());
    console.log('  Database ready');

    console.log('  Initializing Redis...');
    redisService = new RedisService();

    let retries = 0;
    while (!redisService.isHealthy() && retries < 10) {
      console.log(`  Waiting for Redis... (${retries + 1}/10)`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries++;
    }

    if (!redisService.isHealthy()) {
      throw new Error('Redis failed to connect after 10 retries');
    }
    console.log('  Redis ready');

    console.log('  Initializing order queue...');
    orderQueue = new OrderQueue();
    console.log('  Order queue ready');

    // PHASE 2 & 3: Initialize JobScheduler (includes RoutingHub)
    console.log('  Initializing job scheduler with routing hub...');
    jobScheduler = new JobScheduler(orderQueue);
    console.log('  Job scheduler ready');

    // PHASE 1: Initialize DEX Workers
    console.log('  Initializing DEX workers...');
    await initializeDexWorkers();
    console.log('  DEX workers ready');

    // PHASE 2 & 3: Setup JobScheduler events
    console.log('  Setting up job scheduler events...');
    setupJobSchedulerEvents();
    console.log('  Job scheduler events ready');

    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Service initialization failed:', error);
    throw error;
  }
}

/**
 * PHASE 1: Initialize DEX Workers
 * Creates 4 independent workers for parallel DEX processing
 */
async function initializeDexWorkers(): Promise<void> {
  const dexNames: Array<'raydium' | 'meteora' | 'orca' | 'jupiter'> = [
    'raydium',
    'meteora',
    'orca',
    'jupiter',
  ];

  console.log('[Workers] Starting DEX workers...');

  for (const dexName of dexNames) {
    try {
      const worker = new DexWorker(
        dexName,
        orderRepository,
        redisService,
        orderQueue.getConnection() // Use shared Redis connection
      );
      dexWorkers.push(worker);
      console.log(`[Workers] ✓ Started ${dexName} worker`);
    } catch (error) {
      console.error(`[Workers] ✗ Failed to start ${dexName} worker:`, error);
      throw error;
    }
  }

  // PHASE 1: Setup process event listener for worker status updates
  setupWorkerEventBridge();

  console.log('[Workers] All DEX workers started successfully');
}

/**
 * PHASE 1: Event Bridge - Connect worker events to WebSocket
 * This is Ani's pattern: Workers emit events, main process broadcasts
 */
function setupWorkerEventBridge(): void {
  console.log('[EventBridge] Setting up process event listener...');

  // Listen for status updates from all workers
  (process as any).on('orderStatusUpdate', (update: any) => {
    console.log('[EventBridge] Received status update:', {
      orderId: update.orderId,
      status: update.status,
      dex: update.dex || 'N/A',
    });

    // Get WebSocket for this order
    const ws = orderQueue.getWebSocket(update.orderId);

    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(update));
        console.log(`[EventBridge] ✓ Broadcasted to order ${update.orderId}`);
      } catch (error) {
        console.error(`[EventBridge] ✗ Failed to send to WebSocket:`, error);
      }
    } else {
      console.log(`[EventBridge] No active WebSocket for order ${update.orderId}`);
    }
  });

  console.log('[EventBridge] Event bridge active');
}

/**
 * PHASE 3: Setup JobScheduler Event Listeners with RoutingHub
 * Intelligent DEX selection using tuple-based optimization
 */
function setupJobSchedulerEvents(): void {
  console.log('[JobScheduler] Setting up event listeners...');

  // Listen for quote completions from workers
  (process as any).on('quoteCompleted', (data: any) => {
    console.log(`[JobScheduler] Quote completed from ${data.dex} for order ${data.orderId}`);
    jobScheduler.addQuoteResult(data.orderId, data.dex, data.quote);
  });

  // Listen for quote failures from workers
  (process as any).on('quoteFailed', (data: any) => {
    console.warn(`[JobScheduler] Quote failed from ${data.dex} for order ${data.orderId}: ${data.error}`);
    jobScheduler.addQuoteFailure(data.orderId, data.dex, data.error);
  });

  // PHASE 3: Enhanced quotes collected handler with RoutingHub
  (process as any).on('quotesCollected', async (data: any) => {
    console.log(`[JobScheduler] All quotes collected for order ${data.orderId}:`, {
      validQuotes: data.validQuotes,
      totalReceived: data.totalReceived,
      strategy: data.strategy,
    });

    const ws = orderQueue.getWebSocket(data.orderId);

    // Broadcast quotes summary to WebSocket
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        orderId: data.orderId,
        status: 'quotes_collected',
        message: `Received ${data.validQuotes} quotes from DEXs`,
        quotes: data.quotes.map((q: any) => ({
          dex: q.provider || q.dex,
          price: q.price,
          estimatedOutput: q.estimatedOutput || q.outputAmount,
          slippage: q.slippage,
          liquidity: q.liquidity,
        })),
        timestamp: new Date().toISOString(),
      }));
    }

    // PHASE 3: Use RoutingHub for intelligent DEX selection
    if (data.quotes.length > 0) {
      try {
        // Get order details
        const order = await orderRepository.getOrderById(data.orderId);
        if (!order) {
          throw new Error('Order not found');
        }

        const strategy: RoutingStrategy = data.strategy || 'BEST_PRICE';

        // PHASE 3: Get RoutingHub and perform intelligent selection
        const routingHub = jobScheduler.getRoutingHub();
        
        // Validate quotes first
        const validation = routingHub.validateQuotes(data.quotes);
        
        if (!validation.valid) {
          throw new Error(`Quote validation failed: ${validation.errors.join(', ')}`);
        }

        // Emit warnings if any
        if (validation.warnings.length > 0 && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            orderId: data.orderId,
            status: 'routing_warnings',
            warnings: validation.warnings,
            timestamp: new Date().toISOString(),
          }));
        }

        // Get full routing analysis
        const analysis = data.routingAnalysis || routingHub.getRoutingAnalysis(data.quotes);

        // Select best route based on strategy
        const selectedRoute = routingHub.selectBestRoute(data.quotes, strategy);

        console.log(`[RoutingHub] Selected ${selectedRoute.provider} using ${strategy}:`, {
          outputAmount: selectedRoute.outputAmount,
          slippage: selectedRoute.slippage,
          liquidity: selectedRoute.liquidity,
          price: selectedRoute.price,
        });

        // PHASE 3: Broadcast detailed selection with market analysis
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            orderId: data.orderId,
            status: 'dex_selected',
            message: `Selected ${selectedRoute.provider} for execution using ${strategy} strategy`,
            selectedRoute: {
              dex: selectedRoute.provider,
              estimatedOutput: selectedRoute.outputAmount,
              slippage: selectedRoute.slippage,
              liquidity: selectedRoute.liquidity,
              price: selectedRoute.price,
            },
            strategy,
            // PHASE 3: Include market metrics for transparency
            marketMetrics: {
              priceSpread: analysis.marketMetrics.priceSpread,
              priceSpreadPercentage: analysis.marketMetrics.priceSpreadPercentage,
              averagePrice: analysis.marketMetrics.averagePrice,
              bestOutputAmount: analysis.marketMetrics.bestOutputAmount,
              worstOutputAmount: analysis.marketMetrics.worstOutputAmount,
              averageSlippage: analysis.marketMetrics.averageSlippage,
              totalLiquidity: analysis.marketMetrics.totalLiquidity,
            },
            // PHASE 3: Show alternative routes for each strategy
            alternativeRoutes: {
              BEST_PRICE: analysis.strategyAnalysis.BEST_PRICE ? {
                dex: analysis.strategyAnalysis.BEST_PRICE.provider,
                outputAmount: analysis.strategyAnalysis.BEST_PRICE.outputAmount,
              } : null,
              LOWEST_SLIPPAGE: analysis.strategyAnalysis.LOWEST_SLIPPAGE ? {
                dex: analysis.strategyAnalysis.LOWEST_SLIPPAGE.provider,
                slippage: analysis.strategyAnalysis.LOWEST_SLIPPAGE.slippage,
              } : null,
              HIGHEST_LIQUIDITY: analysis.strategyAnalysis.HIGHEST_LIQUIDITY ? {
                dex: analysis.strategyAnalysis.HIGHEST_LIQUIDITY.provider,
                liquidity: analysis.strategyAnalysis.HIGHEST_LIQUIDITY.liquidity,
              } : null,
              FASTEST_EXECUTION: analysis.strategyAnalysis.FASTEST_EXECUTION ? {
                dex: analysis.strategyAnalysis.FASTEST_EXECUTION.provider,
              } : null,
            },
            timestamp: new Date().toISOString(),
          }));
        }

        // Trigger swap job on selected DEX
        await orderQueue.addSwapJob(
          selectedRoute.provider as any,
          data.orderId,
          order.tokenIn,
          order.tokenOut,
          order.amountIn
        );

        console.log(`[JobScheduler] Swap job added for ${selectedRoute.provider}`);
      } catch (error) {
        console.error('[JobScheduler] Failed to process quotes with RoutingHub:', error);
        
        // Notify via WebSocket
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            orderId: data.orderId,
            status: 'error',
            message: 'Failed to select route and execute swap',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          }));
        }
      }
    } else {
      console.error(`[JobScheduler] No valid quotes for order ${data.orderId}`);
      
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          orderId: data.orderId,
          status: 'failed',
          message: 'No valid quotes received from any DEX',
          timestamp: new Date().toISOString(),
        }));
      }
    }
  });

  console.log('[JobScheduler] Event listeners ready');
}

/**
 * Register Fastify plugins
 */
async function registerPlugins() {
  try {
    console.log('Registering plugins...');
    
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });
    console.log('  CORS registered');

    await fastify.register(websocketPlugin);
    console.log('  WebSocket registered');

    console.log('Plugins registered successfully');
  } catch (error) {
    console.error('Plugin registration failed:', error);
    throw error;
  }
}

/**
 * Start server and register all routes
 */
async function start() {
  console.log('\nStarting server...\n');
  
  try {
    await initializeServices();
    await registerPlugins();

    // ENDPOINT 1: Health Check
    fastify.get('/health', async (request, reply) => {
      try {
        const dbHealthy = await database.healthCheck().catch(() => false);
        const redisHealthy = redisService.isHealthy();
        const jobSchedulerStats = jobScheduler ? jobScheduler.getStatistics() : null;

        const response = {
          status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealthy ? 'up' : 'down',
            redis: redisHealthy ? 'up' : 'down',
            workers: dexWorkers.length === 4 ? 'up' : 'degraded',
            jobScheduler: jobScheduler ? 'up' : 'down',
            routingHub: jobScheduler ? 'up' : 'down', // PHASE 3: Added
          },
          // PHASE 3: Add scheduler statistics
          statistics: jobSchedulerStats || null,
        };

        reply.raw.writeHead(200, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify(response));
        return reply;
      } catch (error) {
        const errorResponse = {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          services: { database: 'down', redis: 'down', workers: 'down', jobScheduler: 'down', routingHub: 'down' },
        };
        reply.raw.writeHead(503, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify(errorResponse));
        return reply;
      }
    });

    fastify.get('/api/health', async (request, reply) => {
      try {
        const dbHealthy = await database.healthCheck().catch(() => false);
        const redisHealthy = redisService.isHealthy();
        const jobSchedulerStats = jobScheduler ? jobScheduler.getStatistics() : null;

        const response = {
          status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealthy ? 'up' : 'down',
            redis: redisHealthy ? 'up' : 'down',
            workers: dexWorkers.length === 4 ? 'up' : 'degraded',
            jobScheduler: jobScheduler ? 'up' : 'down',
            routingHub: jobScheduler ? 'up' : 'down', // PHASE 3: Added
          },
          statistics: jobSchedulerStats || null,
        };

        return reply.status(200).send(response);
      } catch (error) {
        const errorResponse = {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          services: { database: 'down', redis: 'down', workers: 'down', jobScheduler: 'down', routingHub: 'down' },
        };

        return reply.status(503).send(errorResponse);
      }
    });

    // PHASE 3: Enhanced routing strategies endpoint
    fastify.get('/api/routing-strategies', async () => {
      const strategies = jobScheduler ? jobScheduler.getAvailableStrategies() : {
        strategies: ROUTING_STRATEGIES,
        default: 'BEST_PRICE' as RoutingStrategy,
        descriptions: {
          BEST_PRICE: 'Selects DEX with highest output amount',
          LOWEST_SLIPPAGE: 'Selects DEX with lowest price impact',
          HIGHEST_LIQUIDITY: 'Selects DEX with highest pool liquidity',
          FASTEST_EXECUTION: 'Selects fastest DEX for execution',
        },
      };
      
      return strategies;
    });

    fastify.post<{ Body: OrderRequest }>('/api/quotes', async (request) => {
      const body = request.body;
      validateOrderRequest(body);
      const strategy: RoutingStrategy = body.routingStrategy || 'BEST_PRICE';

      const quote = await httpDexRouter.getBestQuote(
        body.tokenIn,
        body.tokenOut,
        body.amountIn,
        strategy,
      );

      return {
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        amountIn: body.amountIn,
        routingStrategy: strategy,
        quote,
      };
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

        const strategy: RoutingStrategy = body.routingStrategy || 'BEST_PRICE';

         if (body.autoExecute !== false) {  // Default to true
      console.log(`[API] Auto-triggering quote processing for order ${order.id}`);
      
      // Store strategy in order
      (order as any).strategy = strategy;
      
      // Trigger parallel quote processing
      await jobScheduler.addCompareQuotesJob(order, strategy);
      
      console.log(`[API] Quote processing started for order ${order.id}`);
    }


        return {
          orderId: order.id,
          status: 'pending',
          message: 'Order created. Connect to WebSocket for real-time updates.',
          websocketUrl: `/api/orders/execute?orderId=${order.id}&routingStrategy=${strategy}`,
          routingStrategy: strategy,
          autoExecuted: body.autoExecute !== false,
        };
      } catch (error) {
        throw error;
      }
    });

    // ENDPOINT 5: WebSocket for Order Execution
    fastify.register(async function (fastifyInstance) {
      fastifyInstance.get('/api/orders/execute', { websocket: true }, (socket: any, request: any) => {
        const ws = socket;
        console.log('[WebSocket] Client connected');

        const query = (request.query || {}) as { orderId?: string; routingStrategy?: RoutingStrategy };
        const orderId = query.orderId;
        const strategy: RoutingStrategy =
          query.routingStrategy && ROUTING_STRATEGIES.includes(query.routingStrategy)
            ? query.routingStrategy
            : 'BEST_PRICE';

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
              strategy,
              timestamp: Date.now(),
            }));

            // Register WebSocket for event bridge
            orderQueue.registerWebSocket(order.id, ws);
            
            // PHASE 3: Trigger parallel quote processing with strategy
            console.log(`[WebSocket] Triggering parallel quote fetching for order ${order.id} with strategy ${strategy}`);
            (order as any).strategy = strategy;
            await jobScheduler.addCompareQuotesJob(order, strategy);

            console.log(`[WebSocket] Order ${order.id} queued for parallel execution with ${strategy} routing`);
          } catch (error) {
            console.error('[WebSocket] Error:', error);
            errorHandler.handleWebSocketError(
              error instanceof Error ? error : new Error(String(error)),
              ws,
              orderId
            );
            ws.close();
          }
        })();

        ws.on('close', () => {
          console.log(`[WebSocket] Disconnected for order ${orderId}`);
          orderQueue.unregisterWebSocket(orderId);
        });

        ws.on('error', (error: any) => {
          console.error('[WebSocket] Error:', error);
        });
      });
    });

    // --- BOT API ENDPOINTS ---
    interface BotStartRequest {
      tokenIn: string;
      tokenOut: string;
      amountIn: number;
      triggerCondition: 'below' | 'above';
      targetPrice: number;
    }

    fastify.post<{ Body: BotStartRequest }>('/api/bots/start', async (request, reply) => {
      try {
        const { tokenIn, tokenOut, amountIn, triggerCondition, targetPrice } = request.body;

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

    fastify.get('/api/bots/active', async (_request, reply) => {
      try {
        const count = botManager.getActiveBotsCount();
        return { activeBotsCount: count };
      } catch (error) {
        console.error('Failed to get active bot count:', error);
        return reply.status(500).send({ error: 'Failed to get active bot count' });
      }
    });

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

    console.log(`\n✓ Server running at http://localhost:${port}`);
    console.log(`✓ WebSocket endpoint: ws://localhost:${port}/api/orders/execute`);
    console.log(`✓ DEX Workers: ${dexWorkers.length}/4 active`);
    console.log(`✓ JobScheduler: ${jobScheduler ? 'active' : 'inactive'}`);
    console.log(`✓ RoutingHub: ${jobScheduler ? 'active with 4 strategies' : 'inactive'}`);
    console.log('\nAvailable endpoints:');
    console.log(`   GET  /health`);
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/routing-strategies`);
    console.log(`   GET  /api/orders`);
    console.log(`   GET  /api/orders/:orderId`);
    console.log(`   POST /api/orders/execute`);
    console.log(`   POST /api/quotes`);
    console.log(`   WS   /api/orders/execute\n`);
  } catch (error) {
    console.error('\nServer startup error:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 * PHASE 3: Complete cleanup
 */
async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    // PHASE 2 & 3: Cleanup job scheduler and routing hub
    if (jobScheduler) {
      console.log('  Cleaning up job scheduler and routing hub...');
      jobScheduler.cleanup();
      console.log('  ✓ Job scheduler and routing hub cleaned up');
    }

    // PHASE 1: Close all DEX workers
    if (dexWorkers && dexWorkers.length > 0) {
      console.log('  Closing DEX workers...');
      for (const worker of dexWorkers) {
        await worker.close();
      }
      console.log('  ✓ All workers closed');
    }

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

    console.log('✓ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  errorHandler.handleUnhandledRejection(reason, promise);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  errorHandler.handleUncaughtException(error);
});

// Graceful shutdown listeners
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the application
console.log('Calling start() function...');
start().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
