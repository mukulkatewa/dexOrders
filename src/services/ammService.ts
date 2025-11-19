// src/services/ammService.ts
// AMM Service - Implements constant product formula (x * y = k) for liquidity pools

export interface LiquidityPool {
  tokenA: string;
  tokenB: string;
  reserveA: number; // Reserve of token A
  reserveB: number; // Reserve of token B
  totalLiquidity: number; // Total liquidity value (in USD or base token)
  fee: number; // Trading fee (e.g., 0.003 for 0.3%)
  dex: string; // DEX name
  poolAddress?: string; // Optional pool identifier
}

export interface SwapCalculation {
  amountOut: number; // Output amount after swap
  priceImpact: number; // Price impact percentage
  newReserveA: number; // New reserve of token A after swap
  newReserveB: number; // New reserve of token B after swap
  effectivePrice: number; // Effective price (amountOut / amountIn)
}

/**
 * AMM Service - Handles Automated Market Maker calculations
 * Implements the constant product formula: x * y = k
 */
export class AMMService {
  /**
   * Calculate swap output using constant product formula (x * y = k)
   * 
   * Formula:
   * - Constant product: reserveA * reserveB = k (constant)
   * - After swap: (reserveA + amountIn) * (reserveB - amountOut) = k
   * - With fee: (reserveA + amountIn * (1 - fee)) * (reserveB - amountOut) = k
   * 
   * @param pool - Liquidity pool with reserves
   * @param tokenIn - Input token symbol (must be tokenA or tokenB)
   * @param amountIn - Input amount
   * @returns Swap calculation result
   */
  calculateSwap(
    pool: LiquidityPool,
    tokenIn: string,
    amountIn: number
  ): SwapCalculation {
    if (amountIn <= 0) {
      throw new Error('Amount in must be positive');
    }

    // Determine which token is being swapped in
    const isTokenA = tokenIn.toLowerCase() === pool.tokenA.toLowerCase();
    const isTokenB = tokenIn.toLowerCase() === pool.tokenB.toLowerCase();

    if (!isTokenA && !isTokenB) {
      throw new Error(`Token ${tokenIn} not found in pool ${pool.tokenA}/${pool.tokenB}`);
    }

    let reserveIn: number;
    let reserveOut: number;
    let newReserveIn: number;
    let newReserveOut: number;

    if (isTokenA) {
      // Swapping tokenA for tokenB
      reserveIn = pool.reserveA;
      reserveOut = pool.reserveB;
    } else {
      // Swapping tokenB for tokenA
      reserveIn = pool.reserveB;
      reserveOut = pool.reserveA;
    }

    // Apply fee to input amount (fee is deducted from input)
    const amountInWithFee = amountIn * (1 - pool.fee);

    // Constant product formula: k = reserveIn * reserveOut
    // After swap: (reserveIn + amountInWithFee) * (reserveOut - amountOut) = k
    // Solving for amountOut:
    // amountOut = reserveOut - (k / (reserveIn + amountInWithFee))
    // amountOut = reserveOut - (reserveIn * reserveOut) / (reserveIn + amountInWithFee)
    // amountOut = reserveOut * (1 - reserveIn / (reserveIn + amountInWithFee))
    // amountOut = reserveOut * amountInWithFee / (reserveIn + amountInWithFee)

    const k = reserveIn * reserveOut;
    const newReserveInAfterSwap = reserveIn + amountInWithFee;
    const newReserveOutAfterSwap = k / newReserveInAfterSwap;
    const amountOut = reserveOut - newReserveOutAfterSwap;

    // Ensure we don't exceed reserves
    if (amountOut <= 0 || amountOut >= reserveOut) {
      throw new Error('Insufficient liquidity in pool');
    }

    // Calculate new reserves
    if (isTokenA) {
      newReserveIn = newReserveInAfterSwap;
      newReserveOut = newReserveOutAfterSwap;
    } else {
      newReserveIn = newReserveOutAfterSwap;
      newReserveOut = newReserveInAfterSwap;
    }

    // Calculate price impact
    // Price impact = (amountOut / reserveOut) * 100
    const priceImpact = (amountOut / reserveOut) * 100;

    // Calculate effective price
    const effectivePrice = amountOut / amountIn;

    return {
      amountOut,
      priceImpact,
      newReserveA: isTokenA ? newReserveIn : newReserveOut,
      newReserveB: isTokenA ? newReserveOut : newReserveIn,
      effectivePrice,
    };
  }

  /**
   * Calculate the price for a given token pair in a pool
   * Price = reserveB / reserveA (how much tokenB per tokenA)
   * 
   * @param pool - Liquidity pool
   * @param tokenA - First token
   * @returns Price (amount of tokenB per tokenA)
   */
  getPrice(pool: LiquidityPool, tokenA: string): number {
    const isTokenA = tokenA.toLowerCase() === pool.tokenA.toLowerCase();
    
    if (isTokenA) {
      // Price of tokenA in terms of tokenB
      return pool.reserveB / pool.reserveA;
    } else {
      // Price of tokenB in terms of tokenA
      return pool.reserveA / pool.reserveB;
    }
  }

  /**
   * Calculate total liquidity value (simplified - assumes 1:1 USD value)
   * In a real implementation, this would use oracle prices
   * 
   * @param pool - Liquidity pool
   * @returns Total liquidity value
   */
  calculateTotalLiquidity(pool: LiquidityPool): number {
    // Simplified: assume price is reserveB / reserveA
    // Total value = 2 * reserveA * price (since we have both sides)
    const price = this.getPrice(pool, pool.tokenA);
    return 2 * pool.reserveA * price;
  }

  /**
   * Get pool utilization (how much of reserves are being used)
   * 
   * @param pool - Liquidity pool
   * @param amountIn - Amount being swapped in
   * @param tokenIn - Input token
   * @returns Utilization percentage
   */
  getPoolUtilization(pool: LiquidityPool, amountIn: number, tokenIn: string): number {
    const isTokenA = tokenIn.toLowerCase() === pool.tokenA.toLowerCase();
    const reserve = isTokenA ? pool.reserveA : pool.reserveB;
    
    return (amountIn / reserve) * 100;
  }
}

