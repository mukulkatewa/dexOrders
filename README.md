🚀 Order Execution Engine - Solana DEX Aggregator
A high-performance order execution engine that routes trades across multiple Solana DEXs using parallel worker architecture and intelligent routing strategies.

📋 Table of Contents
Overview

Features

Architecture

Tech Stack

Prerequisites

Installation

Configuration

Running the Application

API Documentation

Routing Strategies

Testing

Project Structure

Phase Implementation

WebSocket Integration

Troubleshooting

Performance

🎯 Overview
The Order Execution Engine is a sophisticated trading system that:

Routes orders across 4 major Solana DEXs (Raydium, Meteora, Orca, Jupiter)

Uses parallel worker architecture for optimal performance

Implements mathematical tuple-based route optimization

Provides real-time WebSocket updates

Supports multiple routing strategies based on user preferences

Supported DEXs
DEX	Type	Technology	Speed Rank
Raydium	AMM	Standard Automated Market Maker	1
Meteora	DLMM	Dynamic Liquidity Market Maker	3
Orca	Whirlpool	Concentrated Liquidity	2
Jupiter	Aggregator	Multi-DEX Routing	4 (Fastest)
✨ Features
Core Features
✅ Parallel Quote Fetching - Queries all DEXs simultaneously

✅ Intelligent Route Selection - Mathematical optimization for best execution

✅ Multiple Routing Strategies - BEST_PRICE, LOWEST_SLIPPAGE, HIGHEST_LIQUIDITY, FASTEST_EXECUTION

✅ Real-Time Updates - WebSocket streaming of order status

✅ Persistent Storage - PostgreSQL for order history

✅ Fast Caching - Redis for active orders

✅ Queue Management - BullMQ for reliable job processing

Advanced Features
🎯 Tuple-Based Optimization - Mathematical representation: qi = (Pi, Oi, Si, Li, Di)

📊 Market Analysis - Price spread, liquidity metrics, slippage analysis

🔄 Alternative Routes - Shows what other strategies would select

⚡ High Performance - Sub-10 second order execution

🛡️ Error Handling - Comprehensive error classification and recovery

🏗️ Architecture
System Design
text
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP/WebSocket
       ▼
┌─────────────────────────────────────┐
│         Fastify Server              │
│  ┌─────────────────────────────┐   │
│  │      RoutingHub             │   │
│  │  (Mathematical Selection)   │   │
│  └─────────────────────────────┘   │
└──────────┬──────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │   BullMQ     │
    │  (Redis)     │
    └──────┬───────┘
           │
    ┌──────┴───────────────────┐
    │                          │
    ▼                          ▼
┌─────────┐              ┌─────────┐
│ Worker  │              │ Worker  │
│ Pool    │   ...  x4    │ Pool    │
│(Raydium)│              │(Jupiter)│
└────┬────┘              └────┬────┘
     │                        │
     ▼                        ▼
┌─────────────────────────────────┐
│      MockDexRouter              │
│  (DEX Quote & Swap Execution)   │
└─────────────────────────────────┘
Data Flow
Order Received (HTTP POST)

Stored in PostgreSQL + Redis

4 Quote Jobs Added to BullMQ (Parallel)

Workers Fetch Quotes Simultaneously

RoutingHub Analyzes All Quotes

Best DEX Selected (Strategy-Based)

Swap Job Triggered on Selected DEX

Transaction Executed & Confirmed

Order Status Updated (WebSocket + DB)

🛠️ Tech Stack
Backend
Runtime: Node.js 18+ with TypeScript

Framework: Fastify (High-performance web framework)

Queue: BullMQ + Redis (Job processing)

Database: PostgreSQL 14+ (Order persistence)

Caching: Redis (Active order cache)

WebSocket: @fastify/websocket (Real-time updates)

Key Dependencies
fastify: ^4.x

bullmq: ^5.x

ioredis: ^5.x

pg: ^8.x

typescript: ^5.x

dotenv: ^16.x

📦 Prerequisites
Required Software
Node.js 18.x or higher

PostgreSQL 14.x or higher

Redis 7.x or higher

npm or yarn

Installation Commands
Ubuntu/Debian:

bash
sudo apt update
sudo apt install postgresql-14 redis-server nodejs npm
macOS (using Homebrew):

bash
brew install postgresql@14 redis node
Verify installations:

bash
node --version    # Should be >= 18.x
psql --version    # Should be >= 14.x
redis-cli --version
🚀 Installation
1. Clone Repository
bash
git clone <your-repo-url>
cd order-execution-engine-final
2. Install Dependencies
bash
npm install
3. Setup Database
bash
# Start PostgreSQL
sudo service postgresql start  # Linux
brew services start postgresql@14  # macOS

# Create database
psql -U postgres
CREATE DATABASE order_execution_db;
\q

# Run migrations
psql -U postgres -d order_execution_db -f src/database/schema.sql
4. Setup Redis
bash
# Start Redis
sudo service redis-server start  # Linux
brew services start redis  # macOS

# Verify Redis is running
redis-cli ping  # Should return "PONG"
5. Environment Configuration
Create .env file:

bash
cp .env.example .env
Edit .env with your configuration:

text
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=order_execution_db

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

MAX_RETRY_ATTEMPTS=3
WORKER_CONCURRENCY=5
🎮 Running the Application
Development Mode
bash
npm run dev
Production Mode
bash
# Build TypeScript
npm run build

# Start server
npm start
Server will start at: http://localhost:3000

📡 API Documentation
Base URL
text
http://localhost:3000
1. Health Check
Request:

bash
GET /api/health
Response:

json
{
  "status": "healthy",
  "timestamp": "2025-11-19T18:00:00.000Z",
  "services": {
    "database": "up",
    "redis": "up",
    "workers": "up",
    "routingHub": "up"
  }
}
2. Get Routing Strategies
Request:

bash
GET /api/routing-strategies
Response:

json
{
  "strategies": ["BEST_PRICE", "LOWEST_SLIPPAGE", "HIGHEST_LIQUIDITY", "FASTEST_EXECUTION"],
  "default": "BEST_PRICE",
  "descriptions": {
    "BEST_PRICE": "Selects DEX with highest output amount",
    "LOWEST_SLIPPAGE": "Selects DEX with lowest price impact",
    "HIGHEST_LIQUIDITY": "Selects DEX with highest pool liquidity",
    "FASTEST_EXECUTION": "Selects fastest DEX for execution"
  }
}
3. Get Quote (HTTP)
Request:

bash
POST /api/quotes
Content-Type: application/json

{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "routingStrategy": "BEST_PRICE"
}
Response:

json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "routingStrategy": "BEST_PRICE",
  "quote": {
    "dex": "jupiter",
    "estimatedOutput": 0.5079,
    "price": 0.05098,
    "slippage": 0.0012,
    "liquidity": 8187507
  }
}
4. Execute Order
Request:

bash
POST /api/orders/execute
Content-Type: application/json

{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "orderType": "market",
  "routingStrategy": "BEST_PRICE"
}
Response:

json
{
  "orderId": "9b6b6507-20c9-4654-82a7-8da5e82ff4a7",
  "status": "pending",
  "message": "Order created. Connect to WebSocket for real-time updates.",
  "websocketUrl": "/api/orders/execute?orderId=9b6b6507-20c9-4654-82a7-8da5e82ff4a7&routingStrategy=BEST_PRICE",
  "routingStrategy": "BEST_PRICE",
  "autoExecuted": true
}
5. Get All Orders
Request:

bash
GET /api/orders?limit=10&offset=0
Response:

json
{
  "orders": [
    {
      "id": "9b6b6507-20c9-4654-82a7-8da5e82ff4a7",
      "tokenIn": "SOL",
      "tokenOut": "USDC",
      "amountIn": 10,
      "status": "confirmed",
      "selectedDex": "jupiter",
      "txHash": "5ced7d4c3fe29ce6...",
      "createdAt": "2025-11-19T18:09:50.514Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "count": 10
  }
}
6. Get Order by ID
Request:

bash
GET /api/orders/{orderId}
Response:

json
{
  "id": "9b6b6507-20c9-4654-82a7-8da5e82ff4a7",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "status": "confirmed",
  "selectedDex": "jupiter",
  "txHash": "5ced7d4c3fe29ce6...",
  "retryCount": 0,
  "createdAt": "2025-11-19T18:09:50.514Z",
  "updatedAt": "2025-11-19T18:10:00.123Z"
}
🎯 Routing Strategies
1. BEST_PRICE
Objective: Maximize output amount
Formula: argmax(Oi) where Oi = output amount
Use Case: Best for maximizing returns

Example:

json
{
  "routingStrategy": "BEST_PRICE"
}
2. LOWEST_SLIPPAGE
Objective: Minimize price impact
Formula: argmin(Si) where Si = slippage
Use Case: Best for large orders to minimize price impact

Example:

json
{
  "routingStrategy": "LOWEST_SLIPPAGE"
}
3. HIGHEST_LIQUIDITY
Objective: Maximize pool liquidity
Formula: argmax(Li) where Li = liquidity
Use Case: Best for ensuring order execution in volatile markets

Example:

json
{
  "routingStrategy": "HIGHEST_LIQUIDITY"
}
4. FASTEST_EXECUTION
Objective: Minimize execution time
Formula: argmax(speed_rank(Di)) where Di = DEX identifier
Use Case: Best for time-sensitive trades

Example:

json
{
  "routingStrategy": "FASTEST_EXECUTION"
}
🧪 Testing
Automated Test Suite
Run the complete test suite:

bash
chmod +x test-phase3.sh
./test-phase3.sh
Manual Testing
Test BEST_PRICE:

bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "routingStrategy": "BEST_PRICE"
  }'
Test LOWEST_SLIPPAGE:

bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "routingStrategy": "LOWEST_SLIPPAGE"
  }'
WebSocket Testing
bash
# Install wscat
npm install -g wscat

# Create order and get orderId
ORDER_ID="your-order-id-here"

# Connect to WebSocket
wscat -c "ws://localhost:3000/api/orders/execute?orderId=${ORDER_ID}&routingStrategy=BEST_PRICE"
📁 Project Structure
text
order-execution-engine-final/
├── src/
│   ├── index.ts                 # Main server file
│   ├── types.ts                 # TypeScript interfaces
│   │
│   ├── database/
│   │   ├── db.ts               # PostgreSQL connection
│   │   └── schema.sql          # Database schema
│   │
│   ├── repositories/
│   │   └── orderRepository.ts  # Database queries
│   │
│   ├── services/
│   │   ├── orderQueue.ts       # BullMQ queue management
│   │   ├── redisService.ts     # Redis operations
│   │   ├── mockDexRouter.ts    # DEX interaction simulation
│   │   ├── hub.ts              # RoutingHub (Phase 2)
│   │   └── errorHandler.ts     # Error handling
│   │
│   ├── workers/
│   │   ├── raydiumWorker.ts    # Raydium DEX worker
│   │   ├── meteoraWorker.ts    # Meteora DEX worker
│   │   ├── orcaWorker.ts       # Orca DEX worker
│   │   └── jupiterWorker.ts    # Jupiter DEX worker
│   │
│   └── errors/
│       └── customErrors.ts     # Custom error classes
│
├── .env                        # Environment variables
├── .env.example                # Environment template
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── test-phase3.sh              # Test script
└── README.md                   # This file