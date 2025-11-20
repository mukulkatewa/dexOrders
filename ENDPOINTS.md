# DexOrders API Quick Test Guide

Copy/paste these commands (adjust host, tokens, or payload as needed) to validate every public endpoint exposed by the DexOrders worker-server architecture.

## 1. Health & Metadata

```bash
# Fast liveness
curl http://localhost:3000/health

# Detailed component health
curl http://localhost:3000/api/health

# Available routing strategies
curl http://localhost:3000/api/routing-strategies
```

## 2. Liquidity Pools

```bash
# All pools (summary + reserves)
curl http://localhost:3000/api/liquidity-pools

# Filter by DEX
curl "http://localhost:3000/api/liquidity-pools?dex=raydium"

# Filter by token pair
curl "http://localhost:3000/api/liquidity-pools?tokenA=SOL&tokenB=USDC"
```

## 3. Quotes

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

## 4. Order Lifecycle

```bash
# Create an order (REST)
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
        "tokenIn": "SOL",
        "tokenOut": "USDC",
        "amountIn": 10,
        "orderType": "market",
        "routingStrategy": "BEST_PRICE"
      }'

# List latest orders
curl "http://localhost:3000/api/orders?limit=10&offset=0"

# Fetch one order (replace ORDER_ID)
curl http://localhost:3000/api/orders/ORDER_ID
```

### Concurrent Orders (Parallel Processing)

The system supports concurrent order placement to test parallel processing and concurrency limits (10 jobs/sec per queue). You can place multiple orders simultaneously:

```bash
# Method 1: Using background processes (bash)
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":5,"orderType":"market","routingStrategy":"BEST_PRICE"}' &

curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":8,"orderType":"market","routingStrategy":"LOWEST_SLIPPAGE"}' &

curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":12,"orderType":"market","routingStrategy":"HIGHEST_LIQUIDITY"}' &

wait  # Wait for all background jobs to complete

# Method 2: Using xargs for parallel execution
echo -e '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":5,"orderType":"market","routingStrategy":"BEST_PRICE"}\n{"tokenIn":"SOL","tokenOut":"USDC","amountIn":8,"orderType":"market","routingStrategy":"LOWEST_SLIPPAGE"}\n{"tokenIn":"SOL","tokenOut":"USDC","amountIn":12,"orderType":"market","routingStrategy":"HIGHEST_LIQUIDITY"}' | \
xargs -P 3 -I {} curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{}'

# Method 3: Using the test script (recommended)
./test-phase3.sh  # Includes concurrent orders test (TEST 10)
```

**Concurrency Limits:**

- Each DEX queue processes up to **10 jobs per second**
- 4 DEX queues = up to **40 concurrent jobs** across all DEXs
- Orders are automatically distributed across queues for parallel processing

**Response:** Each concurrent request returns immediately with an `orderId`. Use WebSocket connections or polling to track order status.

## 5. WebSocket Stream

```bash
npm install -g wscat  # if not already installed
wscat -c "ws://localhost:3000/api/orders/execute?orderId=ORDER_ID&routingStrategy=BEST_PRICE"
```

## 6. Convenience Scripts

```bash
./test-endpoints.sh         # smoke test all REST endpoints
./test-liquidity-pools.sh   # detailed liquidity checks
./test-phase3.sh            # scenario / lifecycle validation
```

## 7. Automation Bots API

### Auto-Trading Bot

```bash
# Start an auto-trading bot that monitors prices and executes orders
curl -X POST http://localhost:3000/api/bots/start \
  -H "Content-Type: application/json" \
  -d '{
        "tokenIn": "SOL",
        "tokenOut": "USDC",
        "amountIn": 100,
        "triggerCondition": "below",
        "targetPrice": 50.4
      }'

# Response:
# {
#   "botId": "c690ada7-c15a-4d47-8601-ef626cb8c748",
#   "status": "started"
# }

# List all active bots
curl http://localhost:3000/api/bots/active

# Response:
# {
#   "count": 1,
#   "bots": [
#     {
#       "id": "c690ada7-c15a-4d47-8601-ef626cb8c748",
#       "tokenIn": "SOL",
#       "tokenOut": "USDC",
#       "amountIn": 100,
#       "triggerCondition": "below",
#       "targetPrice": 0.051
#     }
#   ]
# }

# Stop a specific bot
curl -X POST http://localhost:3000/api/bots/stop \
  -H "Content-Type: application/json" \
  -d '{"botId":"c690ada7-c15a-4d47-8601-ef626cb8c748"}'

# Response:
# {
#   "botId": "c690ada7-c15a-4d47-8601-ef626cb8c748",
#   "status": "stopped"
# }
```

**Auto-Trading Bot Parameters:**

- `tokenIn`: Input token symbol (e.g., "SOL")
- `tokenOut`: Output token symbol (e.g., "USDC")
- `amountIn`: Amount to trade when condition is met
- `triggerCondition`: "below" or "above" the target price
- `targetPrice`: Price threshold to trigger the trade
- `botId` (optional): Custom bot ID, otherwise auto-generated

### Arbitrage Detection

```bash
# Check for arbitrage opportunities (default 2% threshold)
curl "http://localhost:3000/api/arbitrage/check?tokenIn=SOL&tokenOut=USDC&amount=100"

# Check with custom threshold (1.5%)
curl "http://localhost:3000/api/arbitrage/check?tokenIn=SOL&tokenOut=USDC&amount=100&thresholdPercent=1.5"

# Response (when opportunity found):
# {
#   "tokenIn": "SOL",
#   "tokenOut": "USDC",
#   "amountIn": 100,
#   "thresholdPercent": 1.5,
#   "opportunity": {
#     "tokenIn": "SOL",
#     "tokenOut": "USDC",
#     "raydiumPrice": 0.0501,
#     "meteoraPrice": 0.0498,
#     "priceDifference": 0.0003,
#     "profitPercentage": 0.6,
#     "buyDex": "meteora",
#     "sellDex": "raydium",
#     "buyPrice": 0.0498,
#     "sellPrice": 0.0501,
#     "allPrices": {
#       "raydium": 0.0501,
#       "meteora": 0.0498,
#       "orca": 0.0500,
#       "jupiter": 0.0500
#     }
#   },
#   "message": "Arbitrage opportunity detected"
# }

# Response (when no opportunity):
# {
#   "tokenIn": "SOL",
#   "tokenOut": "USDC",
#   "amountIn": 100,
#   "thresholdPercent": 2,
#   "opportunity": null,
#   "message": "No arbitrage opportunity above threshold"
# }
```

**Arbitrage Check Parameters:**

- `tokenIn`: Input token symbol (required)
- `tokenOut`: Output token symbol (required)
- `amount`: Amount to check arbitrage for (required)
- `thresholdPercent`: Minimum profit percentage to consider (optional, default: 2%)

> Note: Replace `localhost:3000` or token symbols to match your deployment. All endpoints require the DexOrders server (`npm run dev` or `npm start`) to be running.
