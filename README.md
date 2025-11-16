# Order Execution Engine

## Overview

This project implements the assignment “order execution engine with DEX routing and WebSocket status updates” using Node.js, TypeScript, Fastify, BullMQ, Redis, and PostgreSQL. The system focuses on a single order type (market orders) and uses a mock DEX router that simulates Raydium and Meteora (plus a couple of extra DEXes) with realistic pricing, liquidity, and latency.

Key goals:

- One order type (market) with clear extension points for limit and sniper orders.
- HTTP → WebSocket flow for live status streaming per order.
- Multi‑DEX routing with price, slippage, liquidity, and latency metrics.
- Queue‑based concurrent processing with logging and tests.

## Features

### Core Features

- **Market order execution** with real‑time WebSocket status updates.
- **DEX routing** across Raydium, Meteora, and additional mocked DEXs (Orca, Jupiter).
- **Routing strategies**: best price, lowest slippage, highest liquidity, fastest execution.
- **Order persistence** in PostgreSQL with Redis for active orders.
- **Queue management** using BullMQ for reliable background processing.
- **Health monitoring** via HTTP health endpoints.

### Additional Features (Bots)

- **Auto‑trading bot** that monitors prices and executes trades when conditions are met.
- **Arbitrage bot** that detects price differences between DEXs.

## Architecture

High‑level flow:

1. Client sends `POST /api/orders/execute` to create an order.
2. API validates input and writes the order to PostgreSQL and Redis.
3. Response returns `orderId` and a WebSocket URL.
4. Client opens a WebSocket to `/api/orders/execute?orderId=...`.
5. The server pushes status updates (`pending → routing → building → submitted → confirmed/failed`) over WebSocket.
6. In the background, the order is enqueued in BullMQ and processed by a worker that uses `MockDexRouter` to pick the best DEX and simulate execution.

Data flow:

> Client → Fastify API → Redis + PostgreSQL → BullMQ queue → Worker → Mock DEX Router → PostgreSQL/Redis → WebSocket back to client

### Tech Stack

- **Backend framework:** Fastify
- **Language:** TypeScript
- **Database:** PostgreSQL (e.g. Neon)
- **Cache / active orders:** Redis (e.g. Upstash)
- **Queue:** BullMQ + Redis
- **WebSocket:** `@fastify/websocket`

## Order Type Choice

### Chosen Order Type: Market Orders

This engine processes **market orders only**. Market orders are a good fit because they prioritize immediate execution at the best available price, which keeps the routing logic and tests focused on DEX price discovery instead of complex order book semantics.

**Extension to other order types (limit / sniper):**

- Limit orders can be supported by adding price checks in the worker (e.g. only execute if the current best quote satisfies the limit price, otherwise keep the order pending or canceled).
- Sniper orders can be implemented by adding a monitoring component that watches for new token launches or specific price events and then reuses the same execution pipeline once the trigger condition is met.

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL database (Neon recommended)
- Redis instance (Upstash recommended)

### Installation

1. **Clone the repository**
git clone <your-repo-url>
cd order-execution-engine

2. **Install dependencies**
npm install

3. **Set up environment variables**

Create a `.env` file in the root directory:

Server Configuration
PORT=3000
NODE_ENV=development
HOST=0.0.0.0

PostgreSQL (Neon) Configuration
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

Redis (Upstash) Configuration
REDIS_HOST=your-redis-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

BullMQ Configuration
BULLMQ_REDIS_HOST=your-redis-host.upstash.io
BULLMQ_REDIS_PORT=6379
BULLMQ_REDIS_PASSWORD=your-redis-password

Order Processing Configuration
MAX_CONCURRENT_ORDERS=10
MAX_ORDERS_PER_MINUTE=100
MAX_RETRY_ATTEMPTS=3

4. **Set up database**

Run the following SQL in your PostgreSQL (Neon) SQL Editor:

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
id UUID PRIMARY KEY,
token_in VARCHAR(50) NOT NULL,
token_out VARCHAR(50) NOT NULL,
amount_in DECIMAL(20, 8) NOT NULL,
amount_out DECIMAL(20, 8),
order_type VARCHAR(20) NOT NULL,
status VARCHAR(20) NOT NULL,
selected_dex VARCHAR(20),
execution_price DECIMAL(20, 8),
tx_hash VARCHAR(100),
error_message TEXT,
retry_count INTEGER DEFAULT 0,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create bot_configs table (for bot features)
CREATE TABLE IF NOT EXISTS bot_configs (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id VARCHAR(255) NOT NULL,
token_in VARCHAR(10) NOT NULL,
token_out VARCHAR(10) NOT NULL,
amount_in DECIMAL NOT NULL,
trigger_condition VARCHAR(10) NOT NULL,
target_price DECIMAL NOT NULL,
is_active BOOLEAN DEFAULT true,
created_at TIMESTAMP DEFAULT NOW(),
updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_token_pair ON orders(token_in, token_out);


5. **Start the server**

Development mode with auto-reload
npm run dev

Production mode
npm start


## API Endpoints

### Core HTTP and WebSocket Routes

#### Health

- `GET /health`
  - Basic health check for database and Redis connectivity.
- `GET /api/health`
  - Assignment‑style health endpoint returning structured status and timestamps.

#### Orders

- `GET /api/orders?limit=50&offset=0`
  - Returns paginated list of orders from PostgreSQL.
- `GET /api/orders/:orderId`
  - Returns details for a specific order (checked in Redis first, then PostgreSQL).
- `POST /api/orders/execute`
  - Creates a market order and returns an `orderId` and `websocketUrl`.
  - Request body:

    ```json
    {
      "tokenIn": "SOL",
      "tokenOut": "USDC",
      "amountIn": 25,
      "orderType": "market",
      "slippage": 0.02,
      "routingStrategy": "BEST_PRICE"
    }
    ```

  - Response shape:

    ```json
    {
      "orderId": "uuid",
      "status": "pending",
      "message": "Order created. Connect to WebSocket for real-time updates.",
      "websocketUrl": "/api/orders/execute?orderId=uuid&routingStrategy=BEST_PRICE",
      "routingStrategy": "BEST_PRICE"
    }
    ```

- `WS /api/orders/execute?orderId=<id>&routingStrategy=<strategy>`
  - WebSocket endpoint that streams status updates for a given order.
  - Status lifecycle:
    - `pending` – Order received and queued.
    - `routing` – Comparing DEX prices / selecting DEX.
    - `building` – Creating transaction.
    - `submitted` – Transaction sent to network.
    - `confirmed` – Transaction successful (includes `txHash`, execution price, amountOut, selected DEX).
    - `failed` – Any failure (includes error message).

#### Quotes and Routing Strategies

- `GET /api/routing-strategies`
  - Returns the list of supported routing strategies: `BEST_PRICE`, `LOWEST_SLIPPAGE`, `HIGHEST_LIQUIDITY`, `FASTEST_EXECUTION`.
- `POST /api/quotes`
  - Returns the best quote for a given token pair and amount, using the requested routing strategy.
  - Body:

    ```json
    {
      "tokenIn": "SOL",
      "tokenOut": "USDC",
      "amountIn": 10,
      "routingStrategy": "BEST_PRICE"
    }
    ```

  - Response includes the chosen DEX and quote metrics (price, fee, slippage, liquidity, latencyMs, estimatedOutput).

### Bot and Arbitrage Endpoints

#### 1. Start Auto-Trading Bot
curl -X POST http://localhost:3000/api/bots/start
-H "Content-Type: application/json"
-d '{
"tokenIn": "SOL",
"tokenOut": "USDC",
"amountIn": 100,
"triggerCondition": "below",
"targetPrice": 0.051
}'


**Response:**
{
"success": true,
"botId": "bot-uuid",
"message": "Auto-trading bot started"
}


#### 2. Stop Auto-Trading Bot
curl -X POST http://localhost:3000/api/bots/stop
-H "Content-Type: application/json"
-d '{"botId": "bot-uuid"}'


#### 3. Get Active Bots
curl http://localhost:3000/api/bots/active

**Response:**
{
"activeBotsCount": 1
}

#### 4. Check Arbitrage Opportunity
curl "http://localhost:3000/api/arbitrage/check?tokenIn=SOL&tokenOut=USDC&amount=100"

**Response:**
{
"tokenIn": "SOL",
"tokenOut": "USDC",
"raydiumPrice": 0.0494,
"meteoraPrice": 0.0504,
"priceDifference": 0.001,
"profitPercentage": 2.01
}

### How to Test the API (curl examples)

Assuming the server is running at `http://localhost:3000`:

```bash
# Health
curl "http://localhost:3000/health"
curl "http://localhost:3000/api/health"

# Routing strategies
curl "http://localhost:3000/api/routing-strategies"

# Get best quote
curl -X POST "http://localhost:3000/api/quotes" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "routingStrategy": "BEST_PRICE"
  }'

# Orders list and single order
curl "http://localhost:3000/api/orders?limit=50&offset=0"
curl "http://localhost:3000/api/orders/<ORDER_ID>"

# Create order (market order)
curl -X POST "http://localhost:3000/api/orders/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 25,
    "orderType": "market",
    "slippage": 0.02,
    "routingStrategy": "BEST_PRICE"
  }'

# WebSocket for order lifecycle (requires orderId from previous response)
npm install -g wscat
wscat -c "ws://localhost:3000/api/orders/execute?orderId=<ORDER_ID>&routingStrategy=BEST_PRICE"

# Bot endpoints
curl -X POST "http://localhost:3000/api/bots/start" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 100,
    "triggerCondition": "below",
    "targetPrice": 0.051
  }'

curl -X POST "http://localhost:3000/api/bots/stop" \
  -H "Content-Type: application/json" \
  -d '{"botId": "<BOT_ID>"}'

curl "http://localhost:3000/api/bots/active"

# Arbitrage check
curl "http://localhost:3000/api/arbitrage/check?tokenIn=SOL&tokenOut=USDC&amount=100"
```

## Bot Features Explained

### Auto-Trading Bot
The auto-trading bot monitors token prices and automatically executes trades when your specified conditions are met:

1. You start the bot with target price and condition (above/below)
2. Bot polls DEX prices every 5 seconds
3. When condition is met, bot automatically places order via WebSocket
4. Bot stops after successful execution or manual stop

**Use Case:** Set a target buy price and let the bot execute when market reaches it, even when you're away.

### Arbitrage Bot
The arbitrage bot detects profitable price differences between Raydium and Meteora:

1. Call the API with token pair and amount
2. Bot fetches prices from both DEXs
3. If price difference exceeds threshold (2%), returns opportunity details
4. You can then manually or automatically execute arbitrage trades

**Use Case:** Find profitable opportunities where you can buy cheap on one DEX and sell higher on another.

## Project Structure

```
order-execution-engine/
├── src/
│   ├── bots/                     # Bot implementations
│   │   ├── autoTradingBot.ts     # Auto-trading bot logic
│   │   ├── arbitrageBot.ts       # Arbitrage detection logic
│   │   └── botManager.ts         # Bot lifecycle management
│   ├── database/
│   │   └── db.ts                 # PostgreSQL connection
│   ├── repositories/
│   │   └── orderRepository.ts    # Database queries
│   ├── services/
│   │   ├── mockDexRouter.ts      # Mock DEX price/execution
│   │   ├── redisService.ts       # Redis operations
│   │   ├── orderQueue.ts         # BullMQ queue management
│   │   └── errorHandler.ts       # Error handling
│   ├── errors/
│   │   └── customErrors.ts       # Custom error classes
│   ├── types.ts                  # TypeScript interfaces
│   └── index.ts                  # Main server file
├── .env                          # Environment variables
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

### Manual Testing with cURL

Test all endpoints using the provided cURL commands in the API documentation above.

### WebSocket Testing

If you want to test the WebSocket endpoint manually (without the Node client), you can still use `wscat` with an `orderId` returned from the POST step.

1. Create an order via POST:

```bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 25,
    "orderType": "market",
    "slippage": 0.02
  }'
```

2. Copy the `orderId` from the response and connect with `wscat`:

```bash
npm install -g wscat
wscat -c "ws://localhost:3000/api/orders/execute?orderId=<ORDER_ID>"
```

### Complete Bot Testing Script

#!/bin/bash

Start bot
BOT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/bots/start
-H "Content-Type: application/json"
-d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":100,"triggerCondition":"below","targetPrice":0.051}')

BOT_ID=$(echo "$BOT_RESPONSE" | grep -o '"botId":"[^"]*"' | cut -d'"' -f4)

Check active bots
curl -s http://localhost:3000/api/bots/active

Check arbitrage
curl -s "http://localhost:3000/api/arbitrage/check?tokenIn=SOL&tokenOut=USDC&amount=100"

Wait for bot to potentially execute
sleep 10

Stop bot
curl -s -X POST http://localhost:3000/api/bots/stop
-H "Content-Type: application/json"
-d "{"botId":"$BOT_ID"}"

## Configuration

### Order Processing Limits
- `MAX_CONCURRENT_ORDERS`: Maximum orders processed simultaneously (default: 10)
- `MAX_ORDERS_PER_MINUTE`: Rate limit for order submission (default: 100)
- `MAX_RETRY_ATTEMPTS`: Number of retries for failed orders (default: 3)

### Bot Configuration
- Auto-trading bot checks prices every 5 seconds
- Arbitrage threshold set to 2% profit minimum
- Bots automatically stop after successful execution

## Error Handling

The system includes comprehensive error handling:
- Input validation errors (400)
- Not found errors (404)
- Database/Redis connection errors (500)
- Order execution failures with retry logic
- WebSocket connection error recovery

## Demo Video

[Link to your demo video showing all features]

## Deployment

The application is ready for deployment on platforms like:
- Railway
- Render
- Heroku
- Vercel (for serverless deployment)

Ensure all environment variables are configured in your deployment platform.

## Development

### Available Scripts

npm run dev # Start development server with auto-reload
npm start # Start production server
npm run build # Compile TypeScript to JavaScript

## License

MIT License

## Author

[Mukul katewa]
- GitHub: [@mukulkatewa](https://github.com/mukulkatewa)
- Email: katewamukul@gmail.com

