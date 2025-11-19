# How AMM and Liquidity Pools Work in This System

## Overview

This system simulates Automated Market Makers (AMMs) using the **constant product formula** (x × y = k), which is the foundation of DEXs like Uniswap, Raydium, and others.

## How Liquidity Pools Are Created

### 1. Initial Pool Creation

When the `MockDexRouter` is initialized, it creates liquidity pools in the `initializeLiquidityPools()` method:

```typescript
// For each DEX (raydium, meteora, orca, jupiter)
// For each common token pair (SOL/USDC, SOL/USDT, USDC/USDT)
// Creates a pool with:
- tokenA: First token (e.g., "SOL")
- tokenB: Second token (e.g., "USDC")
- reserveA: Amount of tokenA in the pool
- reserveB: Amount of tokenB in the pool
- fee: Trading fee (0.2% - 0.3% depending on DEX)
- dex: Which DEX this pool belongs to
```

### 2. Pool Reserve Initialization

Each DEX has different base liquidity levels:

- **Jupiter**: 5,000,000 (highest - aggregator)
- **Orca**: 3,000,000
- **Meteora**: 2,000,000
- **Raydium**: 1,500,000 (lowest)

The reserves are initialized with some randomness:

```typescript
reserveA = baseReserve + random(baseReserve * 0.5);
reserveB = baseReserve * 0.05 + random(baseReserve * 0.05 * 0.5);
```

This simulates real-world pools where reserves vary.

### 3. Why "Random" Amounts?

The randomness simulates:

- Different pool sizes across DEXs
- Real-world variation in liquidity
- Different price ratios between tokens

**Important**: These are NOT truly random - they're deterministic within a range to simulate realistic pool states.

## How AMM Swaps Work

### Constant Product Formula: x × y = k

The core AMM formula ensures that:

```
reserveA × reserveB = constant (k)
```

### Swap Calculation

When you swap tokenA for tokenB:

1. **Input**: You send `amountIn` of tokenA
2. **Fee**: A fee (0.2-0.3%) is deducted: `amountInWithFee = amountIn × (1 - fee)`
3. **New Reserve A**: `newReserveA = reserveA + amountInWithFee`
4. **Calculate Output**: Using constant product:
   ```
   k = reserveA × reserveB
   newReserveB = k / newReserveA
   amountOut = reserveB - newReserveB
   ```
5. **Update Pool**: Reserves are updated to `newReserveA` and `newReserveB`

### Price Impact

As you swap more tokens:

- **Larger swaps** = Higher price impact (slippage)
- **Smaller pools** = Higher price impact
- **Price moves** against you (you get less output per input)

## How Prices Change

### Example: Buying USDC with SOL

**Initial State:**

- Reserve SOL: 1,500,000
- Reserve USDC: 75,000
- Price: 1 SOL = 0.05 USDC

**After Swap 1 (10 SOL → USDC):**

- Reserve SOL: 1,509,970 (increased)
- Reserve USDC: 74,500 (decreased)
- Price: 1 SOL = 0.0493 USDC (price went DOWN - you get less USDC per SOL)

**After Swap 2 (20 SOL → USDC):**

- Reserve SOL: 1,529,940 (increased more)
- Reserve USDC: 73,900 (decreased more)
- Price: 1 SOL = 0.0483 USDC (price went DOWN even more)

**Key Insight**: As you buy more USDC, the price of USDC goes UP (you need more SOL to get the same amount of USDC).

### Reversing the Trade

If you then swap USDC back for SOL:

- Reserve SOL decreases
- Reserve USDC increases
- Price moves back toward the original price

## How DEXs Work in This System

### Each DEX Has Its Own Pools

1. **Raydium**: Standard AMM pools

   - Fee: 0.3%
   - Base liquidity: 1,500,000

2. **Meteora**: DLMM (Dynamic Liquidity Market Maker)

   - Fee: 0.3%
   - Base liquidity: 2,000,000
   - Lower slippage due to dynamic bins

3. **Orca**: Concentrated Liquidity (Whirlpool)

   - Fee: 0.2%
   - Base liquidity: 3,000,000
   - More capital efficient

4. **Jupiter**: Aggregator
   - Fee: 0.25%
   - Base liquidity: 5,000,000
   - Routes across multiple DEXs

### Quote Generation

When you request a quote:

1. System gets the pool for that DEX and token pair
2. Uses AMM formula to calculate output amount
3. Returns quote with price, slippage, and liquidity info

### Swap Execution

When a swap is executed:

1. Calculate swap using AMM formula
2. **Update pool reserves** (this is the key - reserves change!)
3. Return swap result with transaction hash

## Testing AMM Behavior

Run the test script to see price changes:

```bash
npx ts-node test-amm-price-changes.ts
```

This will:

1. Show initial pool state
2. Execute multiple swaps (buying USDC with SOL)
3. Show how price changes with each swap
4. Execute a reverse swap
5. Show how price moves back

## Key Takeaways

1. **Pools are persistent**: Once created, they exist for the lifetime of the router instance
2. **Reserves update**: After each swap, pool reserves are updated (simulating real AMM behavior)
3. **Price discovery**: Prices are determined by the ratio of reserves, not external oracles
4. **Slippage increases**: Larger trades have more price impact
5. **Each DEX is independent**: Each DEX has its own pools with different liquidity levels

## Real-World vs. This Simulation

**Real AMMs:**

- Pools exist on-chain
- Anyone can add/remove liquidity
- Reserves update with every transaction
- Prices reflect real market conditions

**This Simulation:**

- Pools exist in memory
- Only swaps update reserves (no liquidity provision)
- Reserves persist for the server session
- Prices are calculated using the same AMM formulas

The core AMM logic is identical - the constant product formula works the same way!
