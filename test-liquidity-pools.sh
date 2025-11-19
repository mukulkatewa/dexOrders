#!/bin/bash

# Detailed test script for the new Liquidity Pools endpoint
# Usage: ./test-liquidity-pools.sh [base_url]

BASE_URL="${1:-http://localhost:3000}"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Testing Liquidity Pools Endpoint"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

# Test 1: Get all pools
echo -e "${BLUE}Test 1: Get All Liquidity Pools${NC}"
response=$(curl -s "$BASE_URL/api/liquidity-pools")
total_pools=$(echo "$response" | jq -r '.summary.totalPools')
total_liquidity=$(echo "$response" | jq -r '.summary.totalLiquidity')
echo "  Total Pools: $total_pools"
echo "  Total Liquidity: $total_liquidity"
echo "  Pools by DEX:"
echo "$response" | jq -r '.summary.poolsByDex | to_entries[] | "    - \(.key): \(.value) pools"'
echo ""

# Test 2: Filter by DEX
echo -e "${BLUE}Test 2: Filter by DEX (Raydium)${NC}"
response=$(curl -s "$BASE_URL/api/liquidity-pools?dex=raydium")
pools_count=$(echo "$response" | jq '.pools | length')
echo "  Found $pools_count pools on Raydium"
echo "  Sample pool:"
echo "$response" | jq '.pools[0] | {tokenA, tokenB, reserveA, reserveB, totalLiquidity, fee, dex}'
echo ""

# Test 3: Filter by token pair
echo -e "${BLUE}Test 3: Filter by Token Pair (SOL/USDC)${NC}"
response=$(curl -s "$BASE_URL/api/liquidity-pools?tokenA=SOL&tokenB=USDC")
pools_count=$(echo "$response" | jq '.pools | length')
echo "  Found $pools_count pools for SOL/USDC"
echo "  Pools across DEXs:"
echo "$response" | jq -r '.pools[] | "    - \(.dex): ReserveA=\(.reserveA | floor), ReserveB=\(.reserveB | floor), TotalLiquidity=\(.totalLiquidity | floor)"'
echo ""

# Test 4: Filter by DEX and token
echo -e "${BLUE}Test 4: Filter by DEX and Token (Jupiter, SOL/USDC)${NC}"
response=$(curl -s "$BASE_URL/api/liquidity-pools?dex=jupiter&tokenA=SOL&tokenB=USDC")
pools_count=$(echo "$response" | jq '.pools | length')
if [ "$pools_count" -gt 0 ]; then
    pool=$(echo "$response" | jq '.pools[0]')
    echo "  Found pool:"
    echo "$pool" | jq '{dex, tokenA, tokenB, reserveA, reserveB, totalLiquidity, fee, poolAddress}'
else
    echo "  No pools found"
fi
echo ""

# Test 5: Verify AMM calculations are working
echo -e "${BLUE}Test 5: Verify AMM Integration${NC}"
echo "  Testing quote endpoint to verify AMM calculations are used..."
quote_response=$(curl -s -X POST "$BASE_URL/api/quotes" \
    -H "Content-Type: application/json" \
    -d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":10,"routingStrategy":"BEST_PRICE"}')

quote_dex=$(echo "$quote_response" | jq -r '.quote.dex')
quote_output=$(echo "$quote_response" | jq -r '.quote.estimatedOutput')
quote_price_impact=$(echo "$quote_response" | jq -r '.quote.priceImpact')
quote_liquidity=$(echo "$quote_response" | jq -r '.quote.liquidity')

echo "  Quote from $quote_dex:"
echo "    Output: $quote_output USDC"
echo "    Price Impact: $(echo "$quote_price_impact * 100" | bc -l | xargs printf "%.4f")%"
echo "    Pool Liquidity: $quote_liquidity"
echo ""

echo -e "${GREEN}✓ All liquidity pool tests completed!${NC}"

