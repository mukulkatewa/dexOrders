/**
 * ORDER EXECUTION ENGINE - Main Server
 * Phase 3: Enhanced WebSocket Updates & Real-Time Market Analysis
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Core dependencies
import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import cors from '@fastify/cors';
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'bullmq';

// Services
import { Database } from './database/db';
import { OrderRepository } from './repositories/orderRepository';
import { RedisService } from './services/redisService';
import { OrderQueue } from './services/orderQueue';
import { MockDexRouter } from './services/mockDexRouter';
import { errorHandler } from './services/errorHandler';
import { RoutingHub } from './services/hub';

// Types
import { Order, OrderRequest, RoutingStrategy } from './types';
import { ValidationError, NotFoundError } from './errors/customErrors';

// Workers
import { createRaydiumWorker } from './workers/raydiumWorker';
import { createMeteoraWorker } from './workers/meteoraWorker';
import { createOrcaWorker } from './workers/orcaWorker';
import { createJupiterWorker } from './workers/jupiterWorker';

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

// Global service instances
let database: Database;
let orderRepository: OrderRepository;
let redisService: RedisService;
let orderQueue: OrderQueue;
let dexWorkers: Worker[] = [];
let routingHub: RoutingHub;

const httpDexRouter = new MockDexRouter();

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
  if (!body) throw new ValidationError('Request body is required');
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
  console.log('[Init] Initializing services...');

  // Database
  database = new Database();
  await database.initialize();
  orderRepository = new OrderRepository(database.getPool());
  console.log('[Init] ✓ Database ready');

  // Redis
  redisService = new RedisService();
  let retries = 0;
  while (!redisService.isHealthy() && retries < 10) {
    console.log(`[Init] Waiting for Redis... (${retries + 1}/10)`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    retries++;
  }
  if (!redisService.isHealthy()) {
    throw new Error('Redis failed to connect');
  }
  console.log('[Init] ✓ Redis ready');

  // Order Queue
  orderQueue = new OrderQueue();
  console.log('[Init] ✓ Order queue ready');

  // RoutingHub
  routingHub = new RoutingHub();
  console.log('[Init] ✓ RoutingHub ready');

  // DEX Workers
  await initializeDexWorkers();

  // Setup quote collection
  setupQuoteCollection();

  console.log('[Init] ✓ All services initialized');
}

/**
 * Initialize 4 DEX Workers
 */
async function initializeDexWorkers(): Promise<void> {
  console.log('[Workers] Starting DEX workers...');

  const connection = orderQueue.getConnection();

  try {
    const raydiumWorker = createRaydiumWorker(connection);
    const meteoraWorker = createMeteoraWorker(connection);
    const orcaWorker = createOrcaWorker(connection);
    const jupiterWorker = createJupiterWorker(connection);

    dexWorkers.push(raydiumWorker, meteoraWorker, orcaWorker, jupiterWorker);

    console.log('[Workers] ✓ All 4 DEX workers started');

    setupWorkerEventBridge();
  } catch (error) {
    console.error('[Workers] ✗ Failed to start workers:', error);
    throw error;
  }
}

/**
 * Event Bridge - Connect worker events to WebSocket
 */
function setupWorkerEventBridge(): void {
  console.log('[EventBridge] Setting up listener...');

  (process as any).on('orderStatusUpdate', (update: any) => {
    const ws = orderQueue.getWebSocket(update.orderId);

    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(update));
        console.log(`[EventBridge] ✓ Sent ${update.status} update to ${update.orderId}`);
      } catch (error) {
        console.error('[EventBridge] ✗ Send failed:', error);
      }
    }
  });

  console.log('[EventBridge] ✓ Event bridge active');
}

/**
 * Setup Quote Collection
 */
function setupQuoteCollection(): void {
  console.log('[QuoteCollection] Setting up collector...');

  const orderQuotes = new Map<
    string,
    {
      quotes: any[];
      strategy: RoutingStrategy;
      receivedCount: number;
    }
  >();

  (process as any).on('orderStrategySet', (data: { orderId: string; strategy: RoutingStrategy }) => {
    if (!orderQuotes.has(data.orderId)) {
      orderQuotes.set(data.orderId, {
        quotes: [],
        strategy: data.strategy,
        receivedCount: 0,
      });
    } else {
      orderQuotes.get(data.orderId)!.strategy = data.strategy;
    }
    console.log(`[QuoteCollection] Strategy set to ${data.strategy} for order ${data.orderId}`);
  });

  (process as any).on('quoteCompleted', (data: any) => {
    const { orderId, dex, quote } = data;

    console.log(`[QuoteCollection] Received quote from ${dex} for order ${orderId}`);

    if (!orderQuotes.has(orderId)) {
      orderQuotes.set(orderId, {
        quotes: [],
        strategy: 'BEST_PRICE',
        receivedCount: 0,
      });
    }

    const orderData = orderQuotes.get(orderId)!;

    orderData.quotes.push({
      dex,
      ...quote,
    });
    orderData.receivedCount++;

    const ws = orderQueue.getWebSocket(orderId);

    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'routing',
          message: `Received quote from ${dex} (${orderData.receivedCount}/4)`,
          quote: {
            dex,
            estimatedOutput: quote.estimatedOutput,
            price: quote.price,
            slippage: quote.slippage,
          },
          timestamp: new Date().toISOString(),
        })
      );
    }

    if (orderData.receivedCount === 4) {
      console.log(
        `[QuoteCollection] All quotes collected for order ${orderId} with strategy ${orderData.strategy}`
      );

      processCollectedQuotes(orderId, orderData.quotes, orderData.strategy);

      orderQuotes.delete(orderId);
    }
  });

  (process as any).on('quoteFailed', (data: any) => {
    const { orderId, dex, error } = data;

    console.warn(`[QuoteCollection] Quote failed from ${dex}: ${error}`);

    if (!orderQuotes.has(orderId)) {
      orderQuotes.set(orderId, {
        quotes: [],
        strategy: 'BEST_PRICE',
        receivedCount: 0,
      });
    }

    const orderData = orderQuotes.get(orderId)!;
    orderData.receivedCount++;

    const ws = orderQueue.getWebSocket(orderId);

    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'routing',
          message: `Quote from ${dex} failed (${orderData.receivedCount}/4)`,
          error,
          timestamp: new Date().toISOString(),
        })
      );
    }

    if (orderData.receivedCount === 4) {
      if (orderData.quotes.length > 0) {
        console.log(
          `[QuoteCollection] Processing ${orderData.quotes.length} valid quotes with strategy ${orderData.strategy}`
        );
        processCollectedQuotes(orderId, orderData.quotes, orderData.strategy);
      } else {
        console.error(`[QuoteCollection] No valid quotes for order ${orderId}`);

        if (ws && ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              orderId,
              status: 'failed',
              message: 'All quote requests failed',
              timestamp: new Date().toISOString(),
            })
          );
        }
      }

      orderQuotes.delete(orderId);
    }
  });

  console.log('[QuoteCollection] ✓ Quote collector active');
}

/**
 * PHASE 3: Process collected quotes with enhanced WebSocket updates
 */
async function processCollectedQuotes(
  orderId: string,
  quotes: any[],
  strategy: RoutingStrategy
): Promise<void> {
  const ws = orderQueue.getWebSocket(orderId);

  try {
    // PHASE 3: Send initial collection confirmation
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'quotes_collected',
          message: `Received ${quotes.length} quotes from DEXs`,
          quotes: quotes.map((q) => ({
            dex: q.dex,
            estimatedOutput: q.estimatedOutput,
            price: q.price,
            slippage: q.slippage,
            liquidity: q.liquidity,
          })),
          timestamp: new Date().toISOString(),
        })
      );
    }

    // PHASE 3: Validate quotes and send warnings immediately
    const validation = routingHub.validateQuotes(quotes);

    if (!validation.valid) {
      if (ws && ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            orderId,
            status: 'validation_failed',
            errors: validation.errors,
            timestamp: new Date().toISOString(),
          })
        );
      }
      throw new Error(`Quote validation failed: ${validation.errors.join(', ')}`);
    }

    // PHASE 3: Send warnings if any
    if (validation.warnings.length > 0 && ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'routing_warnings',
          message: 'Detected potential routing issues',
          warnings: validation.warnings,
          timestamp: new Date().toISOString(),
        })
      );
    }

    // PHASE 3: Broadcast routing analysis start
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'analyzing_routes',
          message: `Analyzing routes using ${strategy} strategy...`,
          strategy,
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Get comprehensive routing analysis
    const analysis = routingHub.getRoutingAnalysis(quotes);

    // PHASE 3: Broadcast market metrics
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'market_analysis',
          message: 'Market analysis completed',
          marketMetrics: {
            totalQuotes: analysis.totalQuotes,
            priceSpread: analysis.marketMetrics.priceSpread.toFixed(6),
            priceSpreadPercentage: analysis.marketMetrics.priceSpreadPercentage.toFixed(2) + '%',
            averagePrice: analysis.marketMetrics.averagePrice.toFixed(6),
            bestOutputAmount: analysis.marketMetrics.bestOutputAmount.toFixed(6),
            worstOutputAmount: analysis.marketMetrics.worstOutputAmount.toFixed(6),
            outputDifference: (
              analysis.marketMetrics.bestOutputAmount - analysis.marketMetrics.worstOutputAmount
            ).toFixed(6),
            averageSlippage: (analysis.marketMetrics.averageSlippage * 100).toFixed(3) + '%',
            totalLiquidity: '$' + analysis.marketMetrics.totalLiquidity.toLocaleString(),
          },
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Select best route
    const bestQuote = routingHub.selectBestRoute(quotes, strategy);

    console.log(`[RoutingHub] Selected ${bestQuote.provider} using ${strategy}:`, {
      outputAmount: bestQuote.outputAmount,
      slippage: bestQuote.slippage,
      liquidity: bestQuote.liquidity,
      price: bestQuote.price,
    });

    // PHASE 3: Send detailed selection with reasoning
    if (ws && ws.readyState === 1) {
      let reasoning = '';
      switch (strategy) {
        case 'BEST_PRICE':
          reasoning = `Highest output amount: ${bestQuote.outputAmount.toFixed(6)} tokens`;
          break;
        case 'LOWEST_SLIPPAGE':
          reasoning = `Lowest price impact: ${(bestQuote.slippage * 100).toFixed(3)}%`;
          break;
        case 'HIGHEST_LIQUIDITY':
          reasoning = `Highest pool liquidity: $${bestQuote.liquidity.toLocaleString()}`;
          break;
        case 'FASTEST_EXECUTION':
          reasoning = `Fastest execution speed (rank 4)`;
          break;
      }

      ws.send(
        JSON.stringify({
          orderId,
          status: 'dex_selected',
          message: `Selected ${bestQuote.provider} for execution`,
          selectedRoute: {
            dex: bestQuote.provider,
            estimatedOutput: bestQuote.outputAmount,
            price: bestQuote.price,
            slippage: (bestQuote.slippage * 100).toFixed(3) + '%',
            liquidity: '$' + bestQuote.liquidity.toLocaleString(),
          },
          strategy,
          reasoning,
          // PHASE 3: Alternative routes
          alternativeRoutes: {
            BEST_PRICE: analysis.strategyAnalysis.BEST_PRICE
              ? {
                  dex: analysis.strategyAnalysis.BEST_PRICE.provider,
                  outputAmount: analysis.strategyAnalysis.BEST_PRICE.outputAmount.toFixed(6),
                  reason: 'Highest output',
                }
              : null,
            LOWEST_SLIPPAGE: analysis.strategyAnalysis.LOWEST_SLIPPAGE
              ? {
                  dex: analysis.strategyAnalysis.LOWEST_SLIPPAGE.provider,
                  slippage: (analysis.strategyAnalysis.LOWEST_SLIPPAGE.slippage * 100).toFixed(3) + '%',
                  reason: 'Lowest slippage',
                }
              : null,
            HIGHEST_LIQUIDITY: analysis.strategyAnalysis.HIGHEST_LIQUIDITY
              ? {
                  dex: analysis.strategyAnalysis.HIGHEST_LIQUIDITY.provider,
                  liquidity: '$' + analysis.strategyAnalysis.HIGHEST_LIQUIDITY.liquidity.toLocaleString(),
                  reason: 'Highest liquidity',
                }
              : null,
            FASTEST_EXECUTION: analysis.strategyAnalysis.FASTEST_EXECUTION
              ? {
                  dex: analysis.strategyAnalysis.FASTEST_EXECUTION.provider,
                  reason: 'Fastest execution',
                }
              : null,
          },
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Get order details
    const order = await orderRepository.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // PHASE 3: Notify swap initiation
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'initiating_swap',
          message: `Preparing swap on ${bestQuote.provider}...`,
          dex: bestQuote.provider,
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Trigger swap
    await orderQueue.addSwapJob(
      bestQuote.provider as any,
      orderId,
      order.tokenIn,
      order.tokenOut,
      order.amountIn
    );

    console.log(`[QuoteCollection] ✓ Swap job added for ${bestQuote.provider}`);
  } catch (error) {
    console.error('[QuoteCollection] ✗ Failed to process quotes with RoutingHub:', error);

    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          orderId,
          status: 'error',
          message: 'Failed to process quotes',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
}

/**
 * Register Fastify plugins
 */
async function registerPlugins() {
  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(websocketPlugin);
  console.log('[Plugins] ✓ Registered');
}

/**
 * Start server and register routes
 */
async function start() {
  try {
    await initializeServices();
    await registerPlugins();

    // Health endpoints
    fastify.get('/health', async () => {
      const dbHealthy = await database.healthCheck().catch(() => false);
      const redisHealthy = redisService.isHealthy();

      return {
        status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealthy ? 'up' : 'down',
          redis: redisHealthy ? 'up' : 'down',
          workers: dexWorkers.length === 4 ? 'up' : 'degraded',
          routingHub: routingHub ? 'up' : 'down',
        },
      };
    });

    fastify.get('/api/health', async () => {
      const dbHealthy = await database.healthCheck().catch(() => false);
      const redisHealthy = redisService.isHealthy();

      return {
        status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealthy ? 'up' : 'down',
          redis: redisHealthy ? 'up' : 'down',
          workers: dexWorkers.length === 4 ? 'up' : 'degraded',
          routingHub: routingHub ? 'up' : 'down',
        },
      };
    });

    fastify.get('/api/routing-strategies', async () => {
      return routingHub.getAvailableStrategies();
    });

    fastify.post<{ Body: OrderRequest }>('/api/quotes', async (request) => {
      const body = request.body;
      validateOrderRequest(body);
      const strategy: RoutingStrategy = body.routingStrategy || 'BEST_PRICE';

      const quote = await httpDexRouter.getBestQuote(body.tokenIn, body.tokenOut, body.amountIn, strategy);

      return {
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        amountIn: body.amountIn,
        routingStrategy: strategy,
        quote,
      };
    });

    fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/api/orders', async (request) => {
      const limit = Math.min(parseInt(request.query.limit || '50'), 1000);
      const offset = Math.max(parseInt(request.query.offset || '0'), 0);

      const orders = await orderRepository.getOrders(limit, offset);

      return {
        orders,
        pagination: { limit, offset, count: orders.length },
      };
    });

    fastify.get<{ Params: { orderId: string } }>('/api/orders/:orderId', async (request) => {
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
    });

    fastify.post<{ Body: OrderRequest }>('/api/orders/execute', async (request) => {
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

      if (body.autoExecute !== false) {
        console.log(`[API] Triggering parallel quotes for ${order.id} with ${strategy}`);
        await orderQueue.addCompareQuotesJob(order, strategy);
      }

      return {
        orderId: order.id,
        status: 'pending',
        message: 'Order created. Connect to WebSocket for real-time updates.',
        websocketUrl: `/api/orders/execute?orderId=${order.id}&routingStrategy=${strategy}`,
        routingStrategy: strategy,
        autoExecuted: body.autoExecute !== false,
      };
    });

    fastify.register(async function (fastifyInstance) {
      fastifyInstance.get('/api/orders/execute', { websocket: true }, (socket: any, request: any) => {
        const ws = socket;
        const query = (request.query || {}) as {
          orderId?: string;
          routingStrategy?: RoutingStrategy;
        };
        const orderId = query.orderId;
        const strategy: RoutingStrategy =
          query.routingStrategy && ROUTING_STRATEGIES.includes(query.routingStrategy)
            ? query.routingStrategy
            : 'BEST_PRICE';

        if (!orderId) {
          ws.send(
            JSON.stringify({
              status: 'error',
              message: 'orderId query parameter is required',
              timestamp: new Date().toISOString(),
            })
          );
          ws.close();
          return;
        }

        (async () => {
          try {
            let order =
              (await redisService.getActiveOrder(orderId)) ||
              (await orderRepository.getOrderById(orderId));

            if (!order) {
              ws.send(
                JSON.stringify({
                  orderId,
                  status: 'error',
                  message: 'Order not found',
                  timestamp: new Date().toISOString(),
                })
              );
              ws.close();
              return;
            }

            orderQueue.registerWebSocket(order.id, ws);

            ws.send(
              JSON.stringify({
                orderId: order.id,
                status: 'pending',
                message: 'Order received and queued for execution',
                strategy,
                timestamp: new Date().toISOString(),
              })
            );

            console.log(`[WebSocket] Triggering parallel quotes for ${order.id} with ${strategy}`);
            await orderQueue.addCompareQuotesJob(order, strategy);
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
          console.log(`[WebSocket] Disconnected: ${orderId}`);
          orderQueue.unregisterWebSocket(orderId);
        });

        ws.on('error', (error: any) => {
          console.error('[WebSocket] Error:', error);
        });
      });
    });

    fastify.setErrorHandler(async (error, request, reply) => {
      const errorInstance = error instanceof Error ? error : new Error(String(error));
      await errorHandler.handleError(errorInstance, request, reply);
    });

    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    console.log(`\n✓ Server running at http://localhost:${port}`);
    console.log(`✓ WebSocket: ws://localhost:${port}/api/orders/execute`);
    console.log(`✓ DEX Workers: ${dexWorkers.length}/4 active`);
    console.log('✓ Quote Collection: active');
    console.log('✓ RoutingHub: active with 4 strategies');
    console.log('✓ Phase 3: Enhanced WebSocket updates active\n');
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  GET  /api/health');
    console.log('  GET  /api/routing-strategies');
    console.log('  GET  /api/orders');
    console.log('  GET  /api/orders/:orderId');
    console.log('  POST /api/orders/execute');
    console.log('  POST /api/quotes');
    console.log('  WS   /api/orders/execute\n');
  } catch (error) {
    console.error('\n✗ Server startup error:', error);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  console.log(`\n✓ Received ${signal}, shutting down...`);

  try {
    if (dexWorkers && dexWorkers.length > 0) {
      console.log('  Closing DEX workers...');
      for (const worker of dexWorkers) {
        await worker.close();
      }
      console.log('  ✓ Workers closed');
    }

    if (orderQueue) {
      console.log('  Closing order queue...');
      await orderQueue.close();
    }

    if (redisService) {
      console.log('  Closing Redis...');
      await redisService.close();
    }

    if (database) {
      console.log('  Closing database...');
      await database.close();
    }

    console.log('  Closing server...');
    await fastify.close();

    console.log('✓ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('✗ Shutdown error:', error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  errorHandler.handleUnhandledRejection(reason, promise);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  errorHandler.handleUncaughtException(error);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
