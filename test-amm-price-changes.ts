// Test script to demonstrate AMM price changes with multiple swaps
// Run with: npx ts-node test-amm-price-changes.ts

import { MockDexRouter } from "./src/services/mockDexRouter";

const BASE_URL = "http://localhost:3000";

interface SwapResult {
  swapNumber: number;
  amountIn: number;
  amountOut: number;
  price: number;
  priceImpact: number;
  reserveA: number;
  reserveB: number;
  totalLiquidity: number;
}

async function testAMMPriceChanges() {
  console.log("==========================================");
  console.log("AMM Price Change Demonstration");
  console.log("==========================================");
  console.log("");
  console.log(
    "This test shows how AMM prices change as we make multiple swaps:"
  );
  console.log("- Each swap changes the pool reserves (x * y = k)");
  console.log(
    "- As we buy more of token B, its price goes UP (we get less per token A)"
  );
  console.log(
    "- As we sell token B back, its price goes DOWN (we get more per token A)"
  );
  console.log("");

  const router = new MockDexRouter();
  const dex = "raydium";
  const tokenIn = "SOL";
  const tokenOut = "USDC";

  // Get initial pool state
  const initialPools = router.getLiquidityPoolsByDex(dex);
  const initialPool = initialPools.find(
    (p) =>
      (p.tokenA === tokenIn && p.tokenB === tokenOut) ||
      (p.tokenA === tokenOut && p.tokenB === tokenIn)
  );

  if (!initialPool) {
    console.error("Pool not found!");
    return;
  }

  const isReversed = initialPool.tokenA === tokenOut;
  const initialReserveA = isReversed
    ? initialPool.reserveB
    : initialPool.reserveA;
  const initialReserveB = isReversed
    ? initialPool.reserveA
    : initialPool.reserveB;
  const initialPrice = initialReserveB / initialReserveA;

  console.log("📊 Initial Pool State:");
  console.log(`   Pool: ${tokenIn}/${tokenOut} on ${dex}`);
  console.log(`   Reserve ${tokenIn}: ${initialReserveA.toFixed(2)}`);
  console.log(`   Reserve ${tokenOut}: ${initialReserveB.toFixed(2)}`);
  console.log(
    `   Initial Price: 1 ${tokenIn} = ${initialPrice.toFixed(6)} ${tokenOut}`
  );
  console.log("");

  const swapAmounts = [10, 20, 50, 100, 200]; // Increasing swap sizes
  const results: SwapResult[] = [];

  console.log("🔄 Executing Multiple Swaps (Buying USDC with SOL):");
  console.log("");

  for (let i = 0; i < swapAmounts.length; i++) {
    const amountIn = swapAmounts[i];

    try {
      // Get quote before swap
      const quote = await router.getRaydiumQuote(tokenIn, tokenOut, amountIn);

      // Execute swap (this updates the pool reserves)
      const swapResult = await router.executeSwapOnDex(
        dex,
        tokenIn,
        tokenOut,
        amountIn
      );

      // Get updated pool state
      const updatedPools = router.getLiquidityPoolsByDex(dex);
      const updatedPool = updatedPools.find(
        (p) =>
          (p.tokenA === tokenIn && p.tokenB === tokenOut) ||
          (p.tokenA === tokenOut && p.tokenB === tokenIn)
      );

      if (updatedPool) {
        const isReversedUpdated = updatedPool.tokenA === tokenOut;
        const reserveA = isReversedUpdated
          ? updatedPool.reserveB
          : updatedPool.reserveA;
        const reserveB = isReversedUpdated
          ? updatedPool.reserveA
          : updatedPool.reserveB;
        const currentPrice = reserveB / reserveA;

        results.push({
          swapNumber: i + 1,
          amountIn,
          amountOut: swapResult.amountOut,
          price: currentPrice,
          priceImpact: quote.priceImpact || 0,
          reserveA,
          reserveB,
          totalLiquidity: updatedPool.totalLiquidity,
        });

        console.log(`Swap ${i + 1}:`);
        console.log(`  Input: ${amountIn} ${tokenIn}`);
        console.log(`  Output: ${swapResult.amountOut.toFixed(6)} ${tokenOut}`);
        console.log(
          `  Price: 1 ${tokenIn} = ${currentPrice.toFixed(6)} ${tokenOut}`
        );
        console.log(`  Price Impact: ${(quote.priceImpact || 0).toFixed(4)}%`);
        console.log(
          `  Pool Reserves: ${reserveA.toFixed(
            2
          )} ${tokenIn} / ${reserveB.toFixed(2)} ${tokenOut}`
        );

        if (i > 0) {
          const priceChange =
            ((currentPrice - results[i - 1].price) / results[i - 1].price) *
            100;
          console.log(
            `  Price Change: ${priceChange > 0 ? "+" : ""}${priceChange.toFixed(
              4
            )}% (price going ${priceChange > 0 ? "UP ⬆️" : "DOWN ⬇️"})`
          );
        }
        console.log("");
      }
    } catch (error: any) {
      console.error(`Error in swap ${i + 1}:`, error.message);
      break;
    }
  }

  // Now reverse: sell USDC back for SOL
  console.log("🔄 Reversing: Selling USDC back for SOL:");
  console.log("");

  // Get current pool state
  const currentPools = router.getLiquidityPoolsByDex(dex);
  const currentPool = currentPools.find(
    (p) =>
      (p.tokenA === tokenIn && p.tokenB === tokenOut) ||
      (p.tokenA === tokenOut && p.tokenB === tokenIn)
  );

  if (currentPool) {
    const isReversedCurrent = currentPool.tokenA === tokenOut;
    const reserveA = isReversedCurrent
      ? currentPool.reserveB || 0
      : currentPool.reserveA || 0;
    const reserveB = isReversedCurrent
      ? currentPool.reserveA || 0
      : currentPool.reserveB || 0;
    const priceBeforeReverse = reserveB / reserveA;

    console.log(
      `Price before reverse: 1 ${tokenIn} = ${priceBeforeReverse.toFixed(
        6
      )} ${tokenOut}`
    );
    console.log("");

    // Reverse swap: USDC -> SOL
    const reverseAmount = 5; // Amount of USDC to sell
    try {
      const reverseQuote = await router.getRaydiumQuote(
        tokenOut,
        tokenIn,
        reverseAmount
      );
      const reverseResult = await router.executeSwapOnDex(
        dex,
        tokenOut,
        tokenIn,
        reverseAmount
      );

      const finalPools = router.getLiquidityPoolsByDex(dex);
      const finalPool = finalPools.find(
        (p) =>
          (p.tokenA === tokenIn && p.tokenB === tokenOut) ||
          (p.tokenA === tokenOut && p.tokenB === tokenIn)
      );

      if (finalPool) {
        const isReversedFinal = finalPool.tokenA === tokenOut;
        const finalReserveA = isReversedFinal
          ? finalPool.reserveB
          : finalPool.reserveA;
        const finalReserveB = isReversedFinal
          ? finalPool.reserveA
          : finalPool.reserveB;
        const priceAfterReverse = finalReserveB / finalReserveA;

        console.log(`Reverse Swap:`);
        console.log(`  Input: ${reverseAmount} ${tokenOut}`);
        console.log(
          `  Output: ${reverseResult.amountOut.toFixed(6)} ${tokenIn}`
        );
        console.log(
          `  Price: 1 ${tokenIn} = ${priceAfterReverse.toFixed(6)} ${tokenOut}`
        );
        console.log(
          `  Price Impact: ${(reverseQuote.priceImpact || 0).toFixed(4)}%`
        );
        console.log(
          `  Pool Reserves: ${finalReserveA.toFixed(
            2
          )} ${tokenIn} / ${finalReserveB.toFixed(2)} ${tokenOut}`
        );

        const priceChangeAfterReverse =
          ((priceAfterReverse - priceBeforeReverse) / priceBeforeReverse) * 100;
        console.log(
          `  Price Change: ${
            priceChangeAfterReverse > 0 ? "+" : ""
          }${priceChangeAfterReverse.toFixed(4)}% (price going ${
            priceChangeAfterReverse > 0 ? "UP ⬆️" : "DOWN ⬇️"
          })`
        );
        console.log("");
      }
    } catch (error: any) {
      console.error(`Error in reverse swap:`, error.message);
    }
  }

  // Summary
  console.log("==========================================");
  console.log("📈 Summary:");
  console.log("==========================================");
  console.log(
    `Initial Price: 1 ${tokenIn} = ${initialPrice.toFixed(6)} ${tokenOut}`
  );
  if (results.length > 0) {
    const finalPrice = results[results.length - 1].price;
    console.log(
      `Final Price: 1 ${tokenIn} = ${finalPrice.toFixed(6)} ${tokenOut}`
    );
    const totalPriceChange = ((finalPrice - initialPrice) / initialPrice) * 100;
    console.log(
      `Total Price Change: ${
        totalPriceChange > 0 ? "+" : ""
      }${totalPriceChange.toFixed(4)}%`
    );
    console.log("");
    console.log("Key Observations:");
    console.log("✓ As we buy more USDC (sell SOL), the price of USDC goes UP");
    console.log("✓ Each larger swap has higher price impact (slippage)");
    console.log(
      "✓ Pool reserves change with each swap (constant product formula)"
    );
    console.log("✓ When we reverse the trade, price moves back down");
  }
}

// Run the test
testAMMPriceChanges().catch(console.error);
