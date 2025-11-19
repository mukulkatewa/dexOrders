# API Endpoints Testing Guide

This document provides a comprehensive guide to testing all API endpoints in the Order Execution Engine.

## Quick Test

Run the automated test script:
```bash
./test-endpoints.sh
```

## Base URL
```
http://localhost:3000
```

## Available Endpoints

### 1. Health Check Endpoints

#### GET `/health`
Basic health check endpoint.

**Example:**
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-19T22:03:56.302Z",
  "services": {
    "database": "up",
    "redis": "up",
    "workers": "up",
    "routingHub": "up"
  }
}
```

#### GET `/api/health`
API health check endpoint (same as above).

---

### 2. Routing Strategies

#### GET `/api/routing-strategies`
Get available routing strategies.

**Example:**
```bash
curl http://localhost:3000/api/routing-strategies
```

**Response:**
```json
{
  "strategies": [
    "BEST_PRICE",
    "LOWEST_SLIPPAGE",
    "HIGHEST_LIQUIDITY",
    "FASTEST_EXECUTION"
  ],
  "default": "BEST_PRICE",
  "descriptions": {
    "BEST_PRICE": "Selects DEX with highest output amount",
    "LOWEST_SLIPPAGE": "Selects DEX with lowest price impact",
    "HIGHEST_LIQUIDITY": "Selects DEX with highest pool liquidity",
    "FASTEST_EXECUTION": "Selects fastest DEX for execution"
  }
}
```

---

### 3. Liquidity Pools (NEW)

#### GET `/api/liquidity-pools`
Get all liquidity pools with optional filters.

**Query Parameters:**
- `dex` (optional): Filter by DEX name (raydium, meteora, orca, jupiter)
- `tokenA` (optional): Filter by first token
- `tokenB` (optional): Filter by second token

**Examples:**

Get all pools:
```bash
curl http://localhost:3000/api/liquidity-pools
```

Filter by DEX:
```bash
curl "http://localhost:3000/api/liquidity-pools?dex=raydium"
```

Filter by token pair:
```bash
curl "http://localhost:3000/api/liquidity-pools?tokenA=SOL&tokenB=USDC"
```

Filter by DEX and token pair:
```bash
curl "http://localhost:3000/api/liquidity-pools?dex=jupiter&tokenA=SOL&tokenB=USDC"
```

**Response:**
```json
{
  "pools": [
    {
      "tokenA": "SOL",
      "tokenB": "USDC",
      "reserveA": 1628574.0893065573,
      "reserveB": 88501.05180935592,
      "totalLiquidity": 177002.10361871184,
      "fee": 0.003,
      "dex": "raydium",
      "poolAddress": "pool_SOL_USDC_raydium"
    }
  ],
  "summary": {
    "totalPools": 12,
    "totalLiquidity": 4495023.522127338,
    "poolsByDex": {
      "raydium": 3,
      "meteora": 3,
      "orca": 3,
      "jupiter": 3
    }
  },
  "timestamp": "2025-11-19T22:03:56.845Z"
}
```

**Detailed Test:**
```bash
./test-liquidity-pools.sh
```

---

### 4. Get Quote

#### POST `/api/quotes`
Get a quote for a token swap.

**Request Body:**
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "routingStrategy": "BEST_PRICE"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/quotes \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "routingStrategy": "BEST_PRICE"
  }'
```

**Response:**
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "routingStrategy": "BEST_PRICE",
  "quote": {
    "dex": "meteora",
    "provider": "meteora",
    "price": 0.0508453863121097,
    "fee": 0.003,
    "estimatedOutput": 0.505253902292843,
    "outputAmount": 0.505253902292843,
    "slippage": 0.0032935126672286826,
    "priceImpact": 0.0032935126672286826,
    "liquidity": 2504021.1693030717,
    "latencyMs": 120
  }
}
```

**Note:** Quotes now use AMM calculations based on liquidity pool reserves!

---

### 5. Orders

#### GET `/api/orders`
Get all orders with pagination.

**Query Parameters:**
- `limit` (optional): Number of orders to return (default: 50, max: 1000)
- `offset` (optional): Number of orders to skip (default: 0)

**Example:**
```bash
curl "http://localhost:3000/api/orders?limit=10&offset=0"
```

**Response:**
```json
{
  "orders": [
    {
      "id": "8fd6d7b4-9bbf-4709-bcac-36e93c4f4f78",
      "tokenIn": "SOL",
      "tokenOut": "USDC",
      "amountIn": 10,
      "orderType": "market",
      "status": "pending",
      "retryCount": 0,
      "createdAt": "2025-11-19T21:56:54.969Z",
      "updatedAt": "2025-11-19T21:56:54.969Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "count": 10
  }
}
```

#### GET `/api/orders/:orderId`
Get a specific order by ID.

**Example:**
```bash
curl http://localhost:3000/api/orders/8fd6d7b4-9bbf-4709-bcac-36e93c4f4f78
```

**Response:**
```json
{
  "id": "8fd6d7b4-9bbf-4709-bcac-36e93c4f4f78",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "orderType": "market",
  "status": "pending",
  "retryCount": 0,
  "createdAt": "2025-11-19T21:56:54.969Z",
  "updatedAt": "2025-11-19T21:56:54.969Z"
}
```

#### POST `/api/orders/execute`
Create and execute a new order.

**Request Body:**
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "orderType": "market",
  "routingStrategy": "BEST_PRICE",
  "slippage": 0.02,
  "autoExecute": true
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "orderType": "market",
    "routingStrategy": "BEST_PRICE"
  }'
```

**Response:**
```json
{
  "orderId": "44f7ec7c-af29-400c-a6d8-f32885fd9578",
  "status": "pending",
  "message": "Order created. Connect to WebSocket for real-time updates.",
  "websocketUrl": "/api/orders/execute?orderId=44f7ec7c-af29-400c-a6d8-f32885fd9578&routingStrategy=BEST_PRICE",
  "routingStrategy": "BEST_PRICE",
  "autoExecuted": true
}
```

---

### 6. WebSocket Endpoint

#### WebSocket `/api/orders/execute`
Connect to WebSocket for real-time order updates.

**Query Parameters:**
- `orderId`: Order ID to track
- `routingStrategy`: Routing strategy to use

**Example (using wscat):**
```bash
wscat -c "ws://localhost:3000/api/orders/execute?orderId=YOUR_ORDER_ID&routingStrategy=BEST_PRICE"
```

**Example (JavaScript):**
```javascript
const ws = new WebSocket('ws://localhost:3000/api/orders/execute?orderId=YOUR_ORDER_ID&routingStrategy=BEST_PRICE');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Order update:', data);
};
```

---

## Test Scripts

### Run All Endpoint Tests
```bash
./test-endpoints.sh
```

### Test Liquidity Pools Specifically
```bash
./test-liquidity-pools.sh
```

### Custom Base URL
```bash
./test-endpoints.sh http://your-server:3000
```

---

## AMM Integration

All quote endpoints now use AMM (Automated Market Maker) calculations based on the constant product formula (x × y = k). The liquidity pools endpoint provides visibility into:

- **Pool Reserves**: Token reserves for each pool
- **Total Liquidity**: Total liquidity value per pool
- **Trading Fees**: Fee structure per DEX
- **Price Impact**: Calculated based on pool depth

Quotes are now calculated using real AMM formulas, providing more accurate pricing based on liquidity pool reserves.

---

## Error Responses

All endpoints return appropriate HTTP status codes:

- `200`: Success
- `400`: Bad Request (validation errors)
- `404`: Not Found
- `500`: Internal Server Error

Error response format:
```json
{
  "error": "Error message",
  "statusCode": 400
}
```

