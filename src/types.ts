export type OrderStatus = 
  | 'pending' 
  | 'routing' 
  | 'building' 
  | 'submitted' 
  | 'confirmed' 
  | 'failed';

export interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut?: number;
  orderType: string;
  status: OrderStatus;
  selectedDex?: string;
  executionPrice?: number;
  txHash?: string;
  retryCount: number;
  errorMessage?: string;
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

export type DexName = 'raydium' | 'meteora';

export interface DexQuote {
  dex: DexName;
  price: number;
  amountOut: number;
  fee: number;
  estimatedGas: number;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  amountOut: number;
  dex: DexName;
}

export interface WebSocketMessage {
  orderId: string;
  status: OrderStatus;
  message?: string;
  data?: any;
  timestamp: number;
}
