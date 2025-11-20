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

# Test 10: Concurrent Orders (Testing parallel processing)
echo -e "${BLUE}[TEST 10] Place Concurrent Orders (Testing Parallel Processing)${NC}"
echo -e "${YELLOW}Placing 5 orders simultaneously to test concurrency limits (10 jobs/sec per queue)...${NC}"
echo ""

# Create temporary file to store order IDs
TEMP_FILE=$(mktemp)
trap "rm -f $TEMP_FILE" EXIT

# Function to place an order
place_order() {
  local strategy=$1
  local amount=$2
  local label=$3
  
  RESPONSE=$(curl -s -X POST "${BASE_URL}/api/orders/execute" \
    -H "Content-Type: application/json" \
    -d "{
      \"tokenIn\": \"SOL\",
      \"tokenOut\": \"USDC\",
      \"amountIn\": ${amount},
      \"orderType\": \"market\",
      \"routingStrategy\": \"${strategy}\"
    }")
  
  ORDER_ID=$(echo "$RESPONSE" | jq -r '.orderId')
  echo "${label}|${strategy}|${amount}|${ORDER_ID}" >> "$TEMP_FILE"
  
  if [ -n "$ORDER_ID" ] && [ "$ORDER_ID" != "null" ]; then
    echo -e "${GREEN}  ✓ ${label}: ${strategy} (${amount} SOL) -> ${ORDER_ID}${NC}"
  else
    echo -e "${YELLOW}  ✗ ${label}: Failed to create order${NC}"
  fi
}

# Place 5 orders concurrently using background processes
place_order "BEST_PRICE" 5 "Order-1" &
place_order "LOWEST_SLIPPAGE" 8 "Order-2" &
place_order "HIGHEST_LIQUIDITY" 12 "Order-3" &
place_order "FASTEST_EXECUTION" 15 "Order-4" &
place_order "BEST_PRICE" 20 "Order-5" &

# Wait for all background jobs to complete
wait

echo ""
echo -e "${YELLOW}All concurrent orders placed. Waiting 10 seconds for processing...${NC}"
sleep 10
echo ""

# Verify all orders were created
echo -e "${BLUE}Verifying concurrent orders:${NC}"
CONCURRENT_COUNT=0
while IFS='|' read -r label strategy amount order_id; do
  if [ -n "$order_id" ] && [ "$order_id" != "null" ]; then
    STATUS=$(curl -s "${BASE_URL}/api/orders/${order_id}" | jq -r '.status // "unknown"')
    echo -e "  ${label}: ${order_id} -> Status: ${STATUS} (${strategy}, ${amount} SOL)"
    CONCURRENT_COUNT=$((CONCURRENT_COUNT + 1))
  fi
done < "$TEMP_FILE"

echo -e "${GREEN}Successfully created ${CONCURRENT_COUNT}/5 concurrent orders${NC}"
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
echo "Concurrent Orders (5 simultaneous):"
if [ -f "$TEMP_FILE" ]; then
  while IFS='|' read -r label strategy amount order_id; do
    echo "  ${label}: ${order_id} (${strategy}, ${amount} SOL)"
  done < "$TEMP_FILE"
fi
echo ""
echo "Check server logs for detailed WebSocket messages and parallel processing!"
echo ""
