# DexOrders – Worker Server Architecture

DexOrders is a production-focused Solana order execution engine that:

- Aggregates quotes across Raydium, Meteora, Orca, and Jupiter
- Applies tuple-based routing strategies to pick the optimal venue
- Streams real-time order progress over WebSocket
- Uses the **DexOrders Liquidity Engine** (constant-product pools) for price discovery
- Enforces queue-based rate limiting (10 jobs/sec per DEX queue ≈ 100 orders/min)

---

## 1. System Overview

| Capability       | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| Market execution | POST `/api/orders/execute` creates an order and auto-subscribes via WebSocket   |
| Parallel quotes  | Dedicated BullMQ queue per DEX to fetch quotes simultaneously                   |
| Routing policies | BEST_PRICE · LOWEST_SLIPPAGE · HIGHEST_LIQUIDITY · FASTEST_EXECUTION            |
| Liquidity engine | DexOrders Liquidity Engine (constant product `x*y=k`) with live reserve updates |
| Backtesting      | Historical strategy testing with performance analytics and synthetic data generation |
| Persistence      | Orders stored in PostgreSQL, hot state cached in Redis                          |
| Observability    | WebSocket status: pending → routing → building → submitted → confirmed          |

### Why Market Orders?

**Market orders** were selected for this implementation because they provide **immediate execution** at current market prices, which is the most common use case for traders prioritizing speed over price guarantees. This order type perfectly showcases parallel quote fetching, intelligent routing, and real-time telemetry without introducing the additional orchestration required for resting orders.

---

## 2. Architecture Snapshot

```
Client (HTTP/WebSocket)
        │
        ▼
Fastify Server (src/index.ts)
        │
┌───────┴─────────┐
│ PostgreSQL      │  ← order history
│ Redis           │  ← active orders + BullMQ storage
└───────┬─────────┘
        │
 BullMQ Queues (raydium | meteora | orca | jupiter)
        │
Workers (src/workers/*)  ← fetch quotes & run swaps
        │
RoutingHub (src/services/hub.ts)
        │
MockDexRouter + DexOrders Liquidity Engine
```

### Execution Flow

1. Client POSTs `/api/orders/execute`
2. Order validated, stored (PostgreSQL) and cached (Redis)
3. Four quote jobs dispatched in parallel (one per DEX queue)
4. Workers fetch quotes via MockDexRouter → DexOrders Liquidity Engine
5. RoutingHub selects the best quote based on strategy
6. Swap job enqueued on chosen DEX queue
7. Worker executes swap, updates reserves, emits status events
8. WebSocket pushes lifecycle events to the client

---

## 3. Key Components

| Path                                  | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `src/index.ts`                        | Fastify bootstrap, plugin registration, REST + WebSocket routes |
| `src/services/orderQueue.ts`          | BullMQ queues + rate limiting                                   |
| `src/services/mockDexRouter.ts`       | Simulated DEX integrations                                      |
| `src/services/ammService.ts`          | DexOrders Liquidity Engine math (`x*y=k`)                       |
| `src/services/hub.ts`                 | Tuple-based routing strategies                                  |
| `src/services/backtestingEngine.ts`   | Backtest orchestration and simulation                           |
| `src/services/historicalDataService.ts` | Historical pool snapshot management                           |
| `src/services/performanceAnalyzer.ts` | Performance metrics calculation                                |
| `src/repositories/orderRepository.ts` | Order persistence                                               |
| `src/repositories/backtestRepository.ts` | Backtest and trade persistence                                |
| `src/workers/*.ts`                    | Raydium/Meteora/Orca/Jupiter workers (quotes + swaps)           |
| `src/bots/*.ts`                       | Automation layer (auto-trader, arbitrage bot, bot manager)      |

### Automation Bots

- `bots/autoTradingBot.ts` – continuously submits strategy-driven orders against live quotes.
- `bots/arbitrageBot.ts` – monitors price divergence and triggers execution when spreads exceed thresholds.
- `bots/botManager.ts` – coordinates bot lifecycle, schedules jobs, and centralizes logging/alerts.
  These modules are optional but demonstrate how DexOrders can power higher-level automated trading workflows on top of the core execution engine.

---

## 4. Installation & Setup

### Prerequisites

- Node.js ≥ 18
- PostgreSQL ≥ 14
- Redis ≥ 7

### Steps

```bash
# 1. Clone
git clone <repo-url>
cd order-execution-engine-final

# 2. Install deps
npm install

# 3. Configure database
sudo service postgresql start            # or brew services start postgresql@14
psql -U postgres -c "CREATE DATABASE order_execution_db;"
psql -U postgres -d order_execution_db -f src/database/schema.sql

# 4. Configure Redis
sudo service redis-server start          # or brew services start redis
redis-cli ping                           # should return PONG

# 5. Environment
cp .env.example .env
# update DB_*, REDIS_*, MAX_RETRY_ATTEMPTS, WORKER_CONCURRENCY, etc.

# 6. Run
npm run dev          # development (ts-node + nodemon)
npm run build && npm start   # production (compiled JS)
```

---

## 5. API Reference (essentials)

### POST `/api/orders/execute`

Creates a market order and returns WebSocket info.

```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 10,
  "orderType": "market",
  "routingStrategy": "BEST_PRICE"
}
```

Response excerpt:

```json
{
  "orderId": "44f7ec7c-af29-400c-a6d8-f32885fd9578",
  "status": "pending",
  "message": "Connect to WebSocket for real-time updates.",
  "websocketUrl": "/api/orders/execute?orderId=44f7ec7c-af29-400c-a6d8-f32885fd9578&routingStrategy=BEST_PRICE"
}
```

### GET `/api/liquidity-pools`

Filter by `dex`, `tokenA`, `tokenB`. Returns pool reserves, fees, liquidity, summaries.

### GET `/api/orders`

`?limit=10&offset=0` pagination. Returns persisted orders plus metadata.

### WebSocket `/api/orders/execute`

Connect with `orderId` and optional `routingStrategy` to receive live updates.

---

## 6. Backtesting System

DexOrders includes a comprehensive backtesting system that allows you to test trading strategies against historical market data. The system simulates trades using historical liquidity pool states and calculates performance metrics.

### Features

- **Historical Data Management**: Store and retrieve historical liquidity pool snapshots
- **Strategy Testing**: Test all 4 routing strategies (BEST_PRICE, LOWEST_SLIPPAGE, HIGHEST_LIQUIDITY, FASTEST_EXECUTION) against historical data
- **Performance Analytics**: Calculate comprehensive metrics including Sharpe ratio, max drawdown, win rate, profit factor, and more
- **Synthetic Data Generation**: Generate realistic historical data using random walk simulation
- **Complete Trade History**: Track every trade with execution details, PnL, and portfolio value over time

### Database Schema

The backtesting system uses three main tables:

- **`backtest_runs`**: Stores backtest configurations and aggregated results
- **`backtest_trades`**: Stores individual trades executed during backtests
- **`historical_pool_snapshots`**: Stores historical liquidity pool states for simulation

### API Endpoints

#### POST `/api/backtest/run`

Start a new backtest asynchronously. Returns immediately with a backtest ID.

```json
{
  "name": "SOL-USDC Strategy Test",
  "strategy": "BEST_PRICE",
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-04-01T00:00:00Z",
  "interval": "1h",
  "initialCapital": 10000,
  "tokenPair": {
    "tokenIn": "SOL",
    "tokenOut": "USDC"
  },
  "tradeSize": 100,
  "maxSlippage": 0.02
}
```

**Response:**
```json
{
  "backtestId": "0914db30-1c1d-4109-b76d-d11d7be0c9a6",
  "status": "running"
}
```

#### GET `/api/backtest/:id`

Retrieve complete backtest results including metrics, trades, and equity curve.

#### GET `/api/backtest/:id/trades`

Get paginated trades for a backtest run.

**Query Parameters:**
- `limit` (default: 100, max: 1000)
- `offset` (default: 0)

#### GET `/api/backtest`

List all backtest runs with optional filters.

**Query Parameters:**
- `strategy`: Filter by routing strategy
- `status`: Filter by status (running, completed, failed)
- `startDate`: Filter by start date
- `endDate`: Filter by end date

#### POST `/api/backtest/compare`

Compare multiple backtest runs side-by-side.

```json
{
  "backtestIds": ["id1", "id2", "id3"]
}
```

#### POST `/api/backtest/generate-data`

Generate synthetic historical liquidity data for testing.

```json
{
  "dexes": ["raydium", "meteora", "orca"],
  "tokenPairs": [
    {"tokenA": "SOL", "tokenB": "USDC"},
    {"tokenA": "ETH", "tokenB": "USDC"}
  ],
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-04-01T00:00:00Z",
  "intervalMinutes": 60,
  "volatility": 0.03,
  "baseReserves": 4000000
}
```

#### DELETE `/api/backtest/:id`

Delete a backtest run and all associated trades.

### Performance Metrics

Each backtest calculates comprehensive performance metrics:

- **Total Return**: Percentage gain/loss from initial capital
- **Sharpe Ratio**: Risk-adjusted return metric
- **Max Drawdown**: Maximum peak-to-trough decline
- **Win Rate**: Percentage of profitable trades
- **Profit Factor**: Ratio of total wins to total losses
- **Average Return**: Mean return per trade
- **Average Winning/Losing Trade**: Average profit/loss per trade

### Usage Example

```bash
# 1. Generate historical data
curl -X POST http://localhost:3000/api/backtest/generate-data \
  -H "Content-Type: application/json" \
  -d '{
    "dexes": ["raydium", "meteora", "orca"],
    "tokenPairs": [{"tokenA": "SOL", "tokenB": "USDC"}],
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-04-01T00:00:00Z",
    "intervalMinutes": 60
  }'

# 2. Start a backtest
curl -X POST http://localhost:3000/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BEST_PRICE Strategy",
    "strategy": "BEST_PRICE",
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-04-01T00:00:00Z",
    "interval": "1h",
    "initialCapital": 10000,
    "tokenPair": {"tokenIn": "SOL", "tokenOut": "USDC"},
    "tradeSize": 100,
    "maxSlippage": 0.02
  }'

# 3. Check backtest status (poll until status is "completed")
curl http://localhost:3000/api/backtest/{backtestId}

# 4. Get results
curl http://localhost:3000/api/backtest/{backtestId}
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `src/services/historicalDataService.ts` | Manages historical pool snapshots and synthetic data generation |
| `src/services/performanceAnalyzer.ts` | Calculates performance metrics from trade data |
| `src/services/backtestingEngine.ts` | Orchestrates backtest execution and simulation |
| `src/repositories/backtestRepository.ts` | Database operations for backtests and trades |

### Configuration Options

- **Interval**: `1m`, `5m`, `1h`, `1d` - Time between simulated trades
- **Initial Capital**: Starting portfolio value
- **Trade Size**: Amount to trade at each interval
- **Max Slippage**: Maximum acceptable slippage (0-1)
- **Strategy**: Routing strategy to test

---

## 7. Routing Strategies

| Strategy             | Goal                | Formula                                               |
| -------------------- | ------------------- | ----------------------------------------------------- |
| BEST_PRICE (default) | Max output          | `max(outputAmount)`                                   |
| LOWEST_SLIPPAGE      | Min price impact    | `min(slippage)`                                       |
| HIGHEST_LIQUIDITY    | Prefer deep pools   | `max(liquidity)`                                      |
| FASTEST_EXECUTION    | Favor faster venues | DEX speed ranking: Jupiter > Meteora > Orca > Raydium |

---

## 8. DexOrders Liquidity Engine

- Implements constant-product pricing (`x * y = k`)
- Maintains 12 liquidity pools (SOL/USDC, SOL/USDT, USDC/USDT across 4 DEXs)
- Updates reserves after every simulated swap
- Produces realistic slippage, price impact, and latency values

### Liquidity Pools & DexOrders AMM

**Pool Inventory**

- Each DEX (Raydium, Meteora, Orca, Jupiter) owns three pools: `SOL/USDC`, `SOL/USDT`, `USDC/USDT`.
- Pools are initialized with different reserve sizes and fee structures to mimic real-world depth.
- Raydium: standard AMM fee (0.3%); Meteora: DLMM-style parameters; Orca: 0.2% “Whirlpool”; Jupiter: 0.25% aggregator fee.

**Constant-Product Mechanics**

- Pricing obeys `x * y = k`. Inputs are discounted by fee before interacting with reserves.
- Output calculation: `Δy = y - (k / (x + Δx * (1 - fee)))`.
- After each swap, reserves (`reserveA`, `reserveB`) are updated and persisted, so future quotes reflect slippage and price impact.

**Price Discovery & Slippage**

- Large trades consume more liquidity, shifting price unfavorably (higher slippage).
- Smaller pools experience more aggressive price swings; larger pools remain stable.
- The routing strategies can target high-liquidity pools to minimize slippage, leveraging these reserve snapshots.

**Testing Liquidity Behavior**

- Run `npx ts-node test-amm-price-changes.ts` to perform sequential buys/sells and observe:
  - Reserve deltas per swap
  - Price impact growth with trade size
  - Reverse trades bringing prices back toward equilibrium

**Why It Matters**

- Even though DexOrders currently simulates DEX connectivity, the liquidity engine guarantees quotes and swaps behave like real constant-product pools.
- This consistency ensures RoutingHub decisions (best price, lowest slippage, etc.) behave the same once hooked to on-chain liquidity or real APIs.

Testing price dynamics:

```bash
npx ts-node test-amm-price-changes.ts
```

The script buys and sells in sequence, demonstrating how reserves and prices move.

---

## 9. Testing & Tooling

| Command                     | Description                   |
| --------------------------- | ----------------------------- |
| `npm test`                  | Jest unit/integration suite   |
| `npm test -- --coverage`    | Coverage report               |
| `./test-endpoints.sh`       | Smoke test all REST endpoints |
| `./test-liquidity-pools.sh` | Validate liquidity API output |
| `./test-phase3.sh`          | Phase 3 scenario checks       |

---

## 10. Project Structure

```
order-execution-engine-final/
├─ src/
│  ├─ index.ts
│  ├─ types.ts
│  ├─ database/
│  │  ├─ db.ts
│  │  └─ schema.sql
│  ├─ repositories/
│  │  ├─ orderRepository.ts
│  │  └─ backtestRepository.ts
│  ├─ services/
│  │  ├─ ammService.ts
│  │  ├─ hub.ts
│  │  ├─ mockDexRouter.ts
│  │  ├─ orderQueue.ts
│  │  ├─ redisService.ts
│  │  ├─ errorHandler.ts
│  │  ├─ historicalDataService.ts
│  │  ├─ performanceAnalyzer.ts
│  │  └─ backtestingEngine.ts
│  ├─ workers/
│  │  ├─ raydiumWorker.ts
│  │  ├─ meteoraWorker.ts
│  │  ├─ orcaWorker.ts
│  │  └─ jupiterWorker.ts
│  └─ tests/…
├─ test-endpoints.sh
├─ test-liquidity-pools.sh
├─ test-amm-price-changes.ts
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## 11. Troubleshooting

| Symptom                       | Checks                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL connection refused | `sudo service postgresql start`, verify `.env` credentials                   |
| Redis connection refused      | `sudo service redis-server start`, ensure port 6379                          |
| Queues stuck                  | Confirm server is running (workers bootstrap inside `index.ts`), check Redis |
| WebSocket 400                 | Provide `orderId` query param and ensure order exists/active                 |

---

## 12. License

ISC License © DexOrders contributors.
