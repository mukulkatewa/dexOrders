import http from 'http';
import https from 'https';
import WebSocket from 'ws';

export interface ExecuteOrderParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  orderType?: string;
  slippage?: number;
}

export class OrderExecutionClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async executeOrder(params: ExecuteOrderParams): Promise<string> {
    const url = new URL('/api/orders/execute', this.baseUrl);

    const body = JSON.stringify({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      orderType: params.orderType ?? 'market',
      slippage: params.slippage,
    });

    const responseText = await this.httpPost(url, body);
    const data = JSON.parse(responseText);

    if (!data.orderId || typeof data.orderId !== 'string') {
      throw new Error('Invalid response from server: missing orderId');
    }

    return data.orderId;
  }

  async connectWebSocket(orderId: string): Promise<void> {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/api/orders/execute?orderId=${encodeURIComponent(orderId)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        console.log('WebSocket connected for order', orderId);
      });

      ws.on('message', (data) => {
        try {
          const text = typeof data === 'string' ? data : data.toString();
          const update = JSON.parse(text);
          console.log('Order update:', update);

          if (update.status === 'confirmed' || update.status === 'failed') {
            ws.close();
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      ws.on('close', () => {
        console.log('WebSocket closed for order', orderId);
        resolve();
      });
    });
  }

  private httpPost(url: URL, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(
                new Error(
                  `HTTP ${res.statusCode}: ${data || res.statusMessage || 'Request failed'}`
                )
              );
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });
  }
}
