# Order Execution Engine

## Overview
A high-performance order execution engine built with TypeScript, Fastify, PostgreSQL, Redis, and BullMQ. This system processes market orders with intelligent DEX routing between Raydium and Meteora, providing real-time WebSocket updates and automated trading capabilities.

## 🎯 Features

### Core Features
- **Market Order Execution** with real-time WebSocket status updates
- **DEX Routing** - Automatically selects best price between Raydium and Meteora
- **Order Persistence** - PostgreSQL database with Redis caching
- **Queue Management** - BullMQ for reliable order processing
- **Health Monitoring** - Real-time system health checks

### Additional Features (Bots)
- **Auto-Trading Bot** - Monitors prices and executes trades when conditions are met
- **Arbitrage Detection Bot** - Identifies profitable price differences between DEXs

<img width="1168" height="773" alt="Screenshot from 2025-11-15 19-39-37" src="https://github.com/user-attachments/assets/05d732b0-7777-4bd9-8997-bbb25bda9c23" />


## 🏗️ Architecture

Client Request → Fastify API → Order Queue (BullMQ) → DEX Router → Mock DEX Execution
↓ ↓ ↓
WebSocket ← Redis Cache → PostgreSQL Database

### Tech Stack
- **Backend Framework:** Fastify (high-performance Node.js)
- **Language:** TypeScript
- **Database:** PostgreSQL (Neon)
- **Cache:** Redis (Upstash)
- **Queue:** BullMQ
- **WebSocket:** @fastify/websocket

## 📋 Order Type: Market Orders

**Why Market Orders?**
Market orders provide immediate execution at the best available price, which is ideal for:
- High liquidity scenarios
- Time-sensitive trades
- Simplicity in implementation and testing

**Extension to Other Order Types:**
The architecture is designed to support limit and sniper orders:
- **Limit Orders:** Add price validation before routing; only execute when market price meets limit price
- **Sniper Orders:** Add token monitoring service; trigger execution when new token is detected

## 🚀 Getting Started

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


## 📡 API Endpoints

### Core Endpoints

#### 1. Health Check
GET /health

**Response:**
{
"status": "healthy",
"timestamp": "2025-11-15T08:53:12.261Z",
"services": {
"database": "up",
"redis": "up"
}
}


#### 2. Get All Orders
GET /api/orders?limit=50&offset=0


**Response:**
{
"orders": [
{
"id": "uuid",
"tokenIn": "SOL",
"tokenOut": "USDC",
"amountIn": 100,
"amountOut": 5.06,
"orderType": "market",
"status": "confirmed",
"selectedDex": "raydium",
"executionPrice": 0.0506,
"txHash": "transaction-hash",
"retryCount": 0,
"errorMessage": null,
"createdAt": "2025-11-15T06:33:14.505Z",
"updatedAt": "2025-11-15T06:33:20.893Z"
}
],
"pagination": {
"limit": 50,
"offset": 0,
"count": 8
}
}


#### 3. Get Order by ID
GET /api/orders/:orderId


#### 4. Execute Order (POST + WebSocket)

**Step 1 – Submit order via HTTP POST**

`POST /api/orders/execute`

Request:
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 25,
  "orderType": "market",
  "slippage": 0.02
}
```

Response:
```json
{
  "orderId": "uuid",
  "status": "pending",
  "message": "Order created. Connect to WebSocket for real-time updates.",
  "websocketUrl": "/api/orders/execute?orderId=uuid"
}
```

**Step 2 – Automatically subscribe to live updates**

In a real client (frontend or Node script), the same logical flow performs the POST and then immediately opens a WebSocket for that `orderId`:

```ts
const res = await fetch('http://localhost:3000/api/orders/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tokenIn: 'SOL', tokenOut: 'USDC', amountIn: 25, orderType: 'market', slippage: 0.02 }),
});

const { orderId } = await res.json();

const ws = new WebSocket(`ws://localhost:3000/api/orders/execute?orderId=${orderId}`);
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Order update:', update);
};
```

From the user’s point of view they “just submit an order”, and the client code automatically starts streaming WebSocket updates for that order.

**Node CLI demo (this repository)**

You can see this full flow using the provided client script, which first POSTs the order and then automatically opens the WebSocket:

```bash
npm run client -- --tokenIn=SOL --tokenOut=USDC --amount=25 --slippage=0.02
```

This prints the created `orderId` and then the live status stream:

- `pending` – Order received and queued
- `routing` – Comparing DEX prices / selecting Raydium vs Meteora
- `building` – Creating transaction
- `submitted` – Transaction sent to network
- `confirmed` – Transaction successful (includes `txHash`, execution price, amountOut, selected DEX)
- `failed` – If any step fails (includes error message)


### Bot Endpoints

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

## 🤖 Bot Features Explained

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

## 📁 Project Structure

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

## 🧪 Testing

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

## 🔧 Configuration

### Order Processing Limits
- `MAX_CONCURRENT_ORDERS`: Maximum orders processed simultaneously (default: 10)
- `MAX_ORDERS_PER_MINUTE`: Rate limit for order submission (default: 100)
- `MAX_RETRY_ATTEMPTS`: Number of retries for failed orders (default: 3)

### Bot Configuration
- Auto-trading bot checks prices every 5 seconds
- Arbitrage threshold set to 2% profit minimum
- Bots automatically stop after successful execution

## 🚨 Error Handling

The system includes comprehensive error handling:
- Input validation errors (400)
- Not found errors (404)
- Database/Redis connection errors (500)
- Order execution failures with retry logic
- WebSocket connection error recovery

## 🎥 Demo Video

[Link to your demo video showing all features]

## 📦 Deployment

The application is ready for deployment on platforms like:
- Railway
- Render
- Heroku
- Vercel (for serverless deployment)

Ensure all environment variables are configured in your deployment platform.

## 🛠️ Development

### Available Scripts

npm run dev # Start development server with auto-reload
npm start # Start production server
npm run build # Compile TypeScript to JavaScript

## 📝 License

MIT License

## 👤 Author

[Mukul katewa]
- GitHub: [@mukulkatewa](https://github.com/mukulkatewa)
- Email: katewamukul@gmail.com

