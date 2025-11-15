export interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut?: number;
  orderType: string;
  status: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  orderType?: string;
  slippage?: number;
}
