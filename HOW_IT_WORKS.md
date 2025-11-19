# How Liquidity Pools and AMM Work - Complete Explanation

## Quick Answer to Your Questions

### 1. How are liquidity pools created?

**Answer**: Pools are created when `MockDexRouter` is initialized:

1. **Initialization**: When the router starts, `initializeLiquidityPools()` runs
2. **For each DEX** (raydium, meteora, orca, jupiter):
   - Creates pools for common pairs: SOL/USDC, SOL/USDT, USDC/USDT
3. **Reserve amounts**:
   - Each DEX has a different base liquidity level
   - Reserves are set with some randomness to simulate real pools
   - Example: Raydium might have 1,500,000 SOL and 75,000 USDC

**The "random" amounts are NOT truly random** - they're:

- Based on DEX-specific base reserves
- Within a realistic range (base ± 50%)
- Deterministic (same each time server restarts)

### 2. How does DEX logic work?

**Answer**: Each DEX has its own pools and uses AMM formulas:

1. **Quote Request**: When you ask for a quote:

   - System finds the pool for that DEX + token pair
   - Uses constant product formula: `x × y = k`
   - Calculates output based on current reserves
   - Returns quote with price, slippage, liquidity

2. **Swap Execution**: When swap is executed:

   - Calculates output using AMM formula
   - **Updates pool reserves** (this is key!)
   - Returns transaction result

3. **Price Changes**: After each swap:
   - Pool reserves change
   - Price changes (ratio of reserves)
   - Next swap uses new reserves

## Testing AMM Price Changes

Run this to see prices change with multiple orders:

```bash
npx ts-node test-amm-price-changes.ts
```

### What You'll See:

1. **Initial State**: Pool with starting reserves and price
2. **Multiple Swaps**: Each swap:
   - Changes reserves
   - Changes price
   - Shows price impact (slippage)
3. **Price Movement**:
   - As you buy more USDC → price goes UP (need more SOL per USDC)
   - As you sell USDC → price goes DOWN (get more SOL per USDC)
4. **Reverse Trade**: Shows price moving back

### Example Output:

```
Initial Price: 1 SOL = 0.047466 USDC

Swap 1 (10 SOL): Price = 0.047465 USDC (price DOWN ⬇️)
Swap 2 (20 SOL): Price = 0.047464 USDC (price DOWN ⬇️)
Swap 3 (50 SOL): Price = 0.047461 USDC (price DOWN ⬇️)
...

Reverse Swap (5 USDC): Price = 0.047450 USDC (price UP ⬆️)
```

## How Pool Reserves Update

### Before Swap:

```
Reserve SOL: 1,636,179
Reserve USDC: 77,662
Price: 1 SOL = 0.047466 USDC
```

### After Swap (10 SOL → USDC):

```
Reserve SOL: 1,636,189 (+10)
Reserve USDC: 77,662.10 (-0.47)
Price: 1 SOL = 0.047465 USDC (slightly lower)
```

**Key Point**: The constant product `k = reserveA × reserveB` stays constant (approximately, after fees).

## Why Prices Change

### Constant Product Formula: x × y = k

- **k** (constant) = reserveA × reserveB
- When you add tokenA, reserveA increases
- To keep k constant, reserveB must decrease
- Less reserveB = higher price for tokenB

### Example:

**Initial**: 100 SOL × 5,000 USDC = 500,000 (k)

**After buying 10 SOL worth of USDC**:

- Add 10 SOL: 110 SOL
- k must stay 500,000
- New USDC: 500,000 / 110 = 4,545 USDC
- You get: 5,000 - 4,545 = 455 USDC
- Price: 4,545 / 110 = 41.32 USDC per SOL (was 50!)

**Price went DOWN** because you added SOL (supply increased).

## DEX Differences

### Raydium (Standard AMM)

- Fee: 0.3%
- Base liquidity: 1,500,000
- Standard constant product formula

### Meteora (DLMM)

- Fee: 0.3%
- Base liquidity: 2,000,000
- Dynamic liquidity bins (simulated as standard AMM)

### Orca (Whirlpool)

- Fee: 0.2%
- Base liquidity: 3,000,000
- Concentrated liquidity (simulated as standard AMM)

### Jupiter (Aggregator)

- Fee: 0.25%
- Base liquidity: 5,000,000
- Routes across multiple DEXs

## Key Code Locations

1. **Pool Creation**: `mockDexRouter.ts` → `initializeLiquidityPools()`
2. **AMM Calculation**: `ammService.ts` → `calculateSwap()`
3. **Reserve Updates**: `mockDexRouter.ts` → `updatePoolReserves()`
4. **Swap Execution**: `mockDexRouter.ts` → `executeSwapOnDex()`

## Real-World vs. Simulation

| Real AMM                 | This Simulation                  |
| ------------------------ | -------------------------------- |
| Pools on blockchain      | Pools in memory                  |
| Anyone can add liquidity | Only swaps update reserves       |
| Reserves persist forever | Reserves reset on server restart |
| Prices from real trades  | Prices from AMM formula          |
| Multiple pools per pair  | One pool per DEX per pair        |

**But the core AMM logic is identical!** The constant product formula works the same way.

## Testing Multiple Orders

You can test with the API:

```bash
# Get initial pool state
curl http://localhost:3000/api/liquidity-pools?dex=raydium&tokenA=SOL&tokenB=USDC

# Make multiple swaps
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/orders/execute \
    -H "Content-Type: application/json" \
    -d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":10,"routingStrategy":"BEST_PRICE"}'
  sleep 2
done

# Check pool state again (reserves should have changed)
curl http://localhost:3000/api/liquidity-pools?dex=raydium&tokenA=SOL&tokenB=USDC
```

## Summary

1. **Pools are created** at startup with realistic reserves
2. **Each DEX has its own pools** with different liquidity levels
3. **Swaps update reserves** using the constant product formula
4. **Prices change** as reserves change (supply/demand)
5. **Larger swaps** = more price impact (slippage)
6. **The AMM logic is real** - same formulas as Uniswap, Raydium, etc.

The "random" amounts are just to simulate realistic pool diversity - the AMM calculations are deterministic and accurate!
