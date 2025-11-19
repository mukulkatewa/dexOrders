#!/bin/bash

echo "========================================="
echo "PHASE 3 TESTING - Order Execution Engine"
echo "========================================="
echo ""

BASE_URL="http://localhost:3000"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo -e "${BLUE}[TEST 1] Health Check${NC}"
curl -s "${BASE_URL}/api/health" | jq '.'
echo ""
echo ""

# Test 2: Routing Strategies
echo -e "${BLUE}[TEST 2] Get Available Routing Strategies${NC}"
curl -s "${BASE_URL}/api/routing-strategies" | jq '.'
echo ""
echo ""

# Test 3: HTTP Quote Request
echo -e "${BLUE}[TEST 3] Get Quote (HTTP)${NC}"
curl -s -X POST "${BASE_URL}/api/quotes" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "routingStrategy": "BEST_PRICE"
  }' | jq '.'
echo ""
echo ""

# Test 4: Order Execution - BEST_PRICE
echo -e "${BLUE}[TEST 4] Execute Order - BEST_PRICE Strategy${NC}"
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/orders/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "orderType": "market",
    "routingStrategy": "BEST_PRICE"
  }')
echo "$RESPONSE" | jq '.'
ORDER_ID_1=$(echo "$RESPONSE" | jq -r '.orderId')
echo -e "${GREEN}Order ID: ${ORDER_ID_1}${NC}"
echo ""
sleep 8
echo ""

# Test 5: Order Execution - LOWEST_SLIPPAGE
echo -e "${BLUE}[TEST 5] Execute Order - LOWEST_SLIPPAGE Strategy${NC}"
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/orders/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "orderType": "market",
    "routingStrategy": "LOWEST_SLIPPAGE"
  }')
echo "$RESPONSE" | jq '.'
ORDER_ID_2=$(echo "$RESPONSE" | jq -r '.orderId')
echo -e "${GREEN}Order ID: ${ORDER_ID_2}${NC}"
echo ""
sleep 8
echo ""

# Test 6: Order Execution - HIGHEST_LIQUIDITY
echo -e "${BLUE}[TEST 6] Execute Order - HIGHEST_LIQUIDITY Strategy${NC}"
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/orders/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "orderType": "market",
    "routingStrategy": "HIGHEST_LIQUIDITY"
  }')
echo "$RESPONSE" | jq '.'
ORDER_ID_3=$(echo "$RESPONSE" | jq -r '.orderId')
echo -e "${GREEN}Order ID: ${ORDER_ID_3}${NC}"
echo ""
sleep 8
echo ""

# Test 7: Order Execution - FASTEST_EXECUTION
echo -e "${BLUE}[TEST 7] Execute Order - FASTEST_EXECUTION Strategy${NC}"
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/orders/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 10,
    "orderType": "market",
    "routingStrategy": "FASTEST_EXECUTION"
  }')
echo "$RESPONSE" | jq '.'
ORDER_ID_4=$(echo "$RESPONSE" | jq -r '.orderId')
echo -e "${GREEN}Order ID: ${ORDER_ID_4}${NC}"
echo ""
sleep 8
echo ""

# Test 8: Get All Orders
echo -e "${BLUE}[TEST 8] Get All Orders${NC}"
curl -s "${BASE_URL}/api/orders?limit=10" | jq '.'
echo ""
echo ""

# Test 9: Get Specific Order
echo -e "${BLUE}[TEST 9] Get Order Details${NC}"
curl -s "${BASE_URL}/api/orders/${ORDER_ID_1}" | jq '.'
echo ""
echo ""

# Summary
echo "========================================="
echo -e "${GREEN}PHASE 3 TESTING COMPLETE${NC}"
echo "========================================="
echo ""
echo "Created Orders:"
echo "  1. BEST_PRICE:         ${ORDER_ID_1}"
echo "  2. LOWEST_SLIPPAGE:    ${ORDER_ID_2}"
echo "  3. HIGHEST_LIQUIDITY:  ${ORDER_ID_3}"
echo "  4. FASTEST_EXECUTION:  ${ORDER_ID_4}"
echo ""
echo "Check server logs for detailed WebSocket messages!"
echo ""
