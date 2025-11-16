import { OrderExecutionClient } from './orderExecutionClient';

interface CliOptions {
  baseUrl: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  orderId?: string;
  count: number;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);

  let baseUrl = 'http://localhost:3000';
  let tokenIn = 'SOL';
  let tokenOut = 'USDC';
  let amount = 10;
  let slippage = 0.02;
  let orderId: string | undefined;
  let count = 1;

  for (const arg of args) {
    if (arg.startsWith('--baseUrl=')) {
      baseUrl = arg.substring('--baseUrl='.length);
    } else if (arg.startsWith('--tokenIn=')) {
      tokenIn = arg.substring('--tokenIn='.length);
    } else if (arg.startsWith('--tokenOut=')) {
      tokenOut = arg.substring('--tokenOut='.length);
    } else if (arg.startsWith('--amount=')) {
      const value = parseFloat(arg.substring('--amount='.length));
      if (!Number.isNaN(value) && value > 0) {
        amount = value;
      }
    } else if (arg.startsWith('--slippage=')) {
      const value = parseFloat(arg.substring('--slippage='.length));
      if (!Number.isNaN(value) && value >= 0) {
        slippage = value;
      }
    } else if (arg.startsWith('--orderId=')) {
      orderId = arg.substring('--orderId='.length);
    } else if (arg.startsWith('--count=')) {
      const value = parseInt(arg.substring('--count='.length), 10);
      if (!Number.isNaN(value) && value > 0) {
        count = value;
      }
    }
  }

  return { baseUrl, tokenIn, tokenOut, amount, slippage, orderId, count };
}

async function main() {
  const { baseUrl, tokenIn, tokenOut, amount, slippage, orderId, count } = parseCliArgs();
  const client = new OrderExecutionClient(baseUrl);

  try {
    if (orderId) {
      console.log('Connecting WebSocket for existing orderId:', orderId);
      await client.connectWebSocket(orderId);
      return;
    }

    console.log('Submitting order via POST /api/orders/execute with:');
    console.log(`  tokenIn=${tokenIn}, tokenOut=${tokenOut}, amountIn=${amount}, slippage=${slippage}, count=${count}`);

    if (count === 1) {
      const createdOrderId = await client.executeOrder({
        tokenIn,
        tokenOut,
        amountIn: amount,
        orderType: 'market',
        slippage,
      });

      console.log('Created order with id:', createdOrderId);
      console.log('Automatically subscribing to WebSocket updates for this order...');

      await client.connectWebSocket(createdOrderId);
    } else {
      const orders = await Promise.all(
        Array.from({ length: count }).map(() =>
          client.executeOrder({
            tokenIn,
            tokenOut,
            amountIn: amount,
            orderType: 'market',
            slippage,
          })
        )
      );

      console.log('Created orders:', orders);
      console.log('Automatically subscribing to WebSocket updates for all orders...');

      await Promise.all(orders.map(id => client.connectWebSocket(id)));
    }
  } catch (error) {
    console.error('Client error:', error);
    process.exit(1);
  }
}

main();
