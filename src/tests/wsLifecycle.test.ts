import WebSocket from 'ws';
import { OrderExecutionClient } from '../orderExecutionClient';

const wsDescribe = process.env.RUN_WS_TESTS === 'true' ? describe : describe.skip;

wsDescribe('WebSocket lifecycle integration', () => {
  jest.setTimeout(20000);

  it('streams pending to confirmed statuses for a new order', async () => {
    const baseUrl = process.env.WS_TEST_BASE_URL || 'http://localhost:3000';
    const client = new OrderExecutionClient(baseUrl);

    const orderId = await client.executeOrder({
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 10,
      orderType: 'market',
      slippage: 0.02,
    });

    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/api/orders/execute?orderId=${encodeURIComponent(orderId)}`;

    const statuses: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('message', (data) => {
        try {
          const text = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(text);

          if (typeof msg.status === 'string') {
            statuses.push(msg.status);
          }

          if (msg.status === 'confirmed' || msg.status === 'failed') {
            ws.close();
          }
        } catch (error) {
          reject(error);
        }
      });

      ws.on('error', (err) => {
        reject(err);
      });

      ws.on('close', () => {
        resolve();
      });
    });

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses[0]).toBe('pending');
    expect(statuses).toEqual(expect.arrayContaining(['routing']));
    expect(statuses[statuses.length - 1] === 'confirmed' || statuses[statuses.length - 1] === 'failed').toBe(true);
  });
});
