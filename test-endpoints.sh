#!/bin/bash

# Test script for all API endpoints
# Usage: ./test-endpoints.sh [base_url]

BASE_URL="${1:-http://localhost:3000}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Testing Order Execution Engine Endpoints"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

# Test counter
PASSED=0
FAILED=0

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local data=$4
    
    echo -e "${YELLOW}Testing: $description${NC}"
    echo "  $method $endpoint"
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASSED${NC} (HTTP $http_code)"
        echo "  Response: $(echo "$body" | jq -c '.' 2>/dev/null || echo "$body" | head -c 200)"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC} (HTTP $http_code)"
        echo "  Response: $(echo "$body" | head -c 200)"
        ((FAILED++))
    fi
    echo ""
}

# 1. Health Check
test_endpoint "GET" "/health" "Health Check (root)"

# 2. API Health Check
test_endpoint "GET" "/api/health" "API Health Check"

# 3. Routing Strategies
test_endpoint "GET" "/api/routing-strategies" "Get Routing Strategies"

# 4. Liquidity Pools - All pools
test_endpoint "GET" "/api/liquidity-pools" "Get All Liquidity Pools"

# 5. Liquidity Pools - Filter by DEX
test_endpoint "GET" "/api/liquidity-pools?dex=raydium" "Get Liquidity Pools (Raydium)"

# 6. Liquidity Pools - Filter by token pair
test_endpoint "GET" "/api/liquidity-pools?tokenA=SOL&tokenB=USDC" "Get Liquidity Pools (SOL/USDC)"

# 7. Get Quote
test_endpoint "POST" "/api/quotes" "Get Quote (BEST_PRICE)" \
    '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":10,"routingStrategy":"BEST_PRICE"}'

# 8. Get Quote - Different strategy
test_endpoint "POST" "/api/quotes" "Get Quote (LOWEST_SLIPPAGE)" \
    '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":10,"routingStrategy":"LOWEST_SLIPPAGE"}'

# 9. Get Orders
test_endpoint "GET" "/api/orders" "Get All Orders"

# 10. Get Orders with pagination
test_endpoint "GET" "/api/orders?limit=10&offset=0" "Get Orders (Paginated)"

# 11. Create Order
ORDER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/orders/execute" \
    -H "Content-Type: application/json" \
    -d '{"tokenIn":"SOL","tokenOut":"USDC","amountIn":10,"orderType":"market","routingStrategy":"BEST_PRICE"}')

echo -e "${YELLOW}Testing: Create Order${NC}"
echo "  POST /api/orders/execute"
ORDER_ID=$(echo "$ORDER_RESPONSE" | jq -r '.orderId' 2>/dev/null)
if [ -n "$ORDER_ID" ] && [ "$ORDER_ID" != "null" ]; then
    echo -e "${GREEN}✓ PASSED${NC}"
    echo "  Order ID: $ORDER_ID"
    echo "  Response: $(echo "$ORDER_RESPONSE" | jq -c '.' 2>/dev/null || echo "$ORDER_RESPONSE" | head -c 200)"
    ((PASSED++))
    
    # 12. Get Order by ID
    sleep 1
    test_endpoint "GET" "/api/orders/$ORDER_ID" "Get Order By ID"
else
    echo -e "${RED}✗ FAILED${NC}"
    echo "  Response: $(echo "$ORDER_RESPONSE" | head -c 200)"
    ((FAILED++))
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total: $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed ✗${NC}"
    exit 1
fi

