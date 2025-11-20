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
| `src/repositories/orderRepository.ts` | Order persistence                                               |
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

## 6. Routing Strategies

| Strategy             | Goal                | Formula                                               |
| -------------------- | ------------------- | ----------------------------------------------------- |
| BEST_PRICE (default) | Max output          | `max(outputAmount)`                                   |
| LOWEST_SLIPPAGE      | Min price impact    | `min(slippage)`                                       |
| HIGHEST_LIQUIDITY    | Prefer deep pools   | `max(liquidity)`                                      |
| FASTEST_EXECUTION    | Favor faster venues | DEX speed ranking: Jupiter > Meteora > Orca > Raydium |

---

## 7. DexOrders Liquidity Engine

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

## 8. Testing & Tooling

| Command                     | Description                   |
| --------------------------- | ----------------------------- |
| `npm test`                  | Jest unit/integration suite   |
| `npm test -- --coverage`    | Coverage report               |
| `./test-endpoints.sh`       | Smoke test all REST endpoints |
| `./test-liquidity-pools.sh` | Validate liquidity API output |
| `./test-phase3.sh`          | Phase 3 scenario checks       |

---

## 9. Project Structure

```
order-execution-engine-final/
├─ src/
│  ├─ index.ts
│  ├─ types.ts
│  ├─ database/
│  │  ├─ db.ts
│  │  └─ schema.sql
│  ├─ repositories/orderRepository.ts
│  ├─ services/
│  │  ├─ ammService.ts
│  │  ├─ hub.ts
│  │  ├─ mockDexRouter.ts
│  │  ├─ orderQueue.ts
│  │  ├─ redisService.ts
│  │  └─ errorHandler.ts
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

## 10. Troubleshooting

| Symptom                       | Checks                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL connection refused | `sudo service postgresql start`, verify `.env` credentials                   |
| Redis connection refused      | `sudo service redis-server start`, ensure port 6379                          |
| Queues stuck                  | Confirm server is running (workers bootstrap inside `index.ts`), check Redis |
| WebSocket 400                 | Provide `orderId` query param and ensure order exists/active                 |

---

## 11. License

ISC License © DexOrders contributors.
