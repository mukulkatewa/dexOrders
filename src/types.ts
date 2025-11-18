// src/types.ts

export type OrderStatus = 
  | 'pending' 
  | 'routing' 
  | 'processing'    // ADDED: For quote collection phase
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
  executedPrice?: number;  // ADDED: Alias for executionPrice (consistency)
  txHash?: string;
  retryCount: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // PHASE 3: Optional metadata for tracking
  strategy?: RoutingStrategy;  // ADDED: Track routing strategy used
  quotesCollected?: number;     // ADDED: Number of quotes received
  quotesReceived?: number;      // ADDED: Total quotes attempted
}

export type RoutingStrategy =
  | 'BEST_PRICE'
  | 'LOWEST_SLIPPAGE'
  | 'HIGHEST_LIQUIDITY'
  | 'FASTEST_EXECUTION';

export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  orderType?: string;
  slippage?: number;
  routingStrategy?: RoutingStrategy;
  autoExecute?: boolean;  // Already present - good!
}

// UPDATED: Support all 4 DEXs
export type DexName = 'raydium' | 'meteora' | 'orca' | 'jupiter';

export interface DexQuote {
  dex: DexName;
  price: number;
  amountOut?: number;           // Optional
  estimatedOutput?: number;     // ADDED: Alternative name
  fee: number;
  estimatedGas?: number;        // Optional
  slippage?: number;            // ADDED: Price impact
  liquidity?: number;           // ADDED: Pool liquidity
  latencyMs?: number;           // ADDED: DEX response time
  provider?: string;            // ADDED: Alternative to dex field
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  amountOut: number;
  dex: DexName | string;  // Allow string for flexibility
}

export interface WebSocketMessage {
  orderId: string;
  status: OrderStatus | string;  // Allow additional statuses
  message?: string;
  data?: any;
  timestamp: number;
  
  // PHASE 3: Optional fields for enhanced messages
  dex?: string;
  quote?: any;
  quotes?: any[];
  selectedRoute?: any;
  marketMetrics?: any;
  alternativeRoutes?: any;
  warnings?: string[];
  errors?: string[];
}

// PHASE 3: Additional type definitions
export interface QuoteTuple {
  price: number;
  outputAmount: number;
  slippage: number;
  liquidity: number;
  provider: string;
  originalQuote?: any;
}

export interface RoutingAnalysis {
  selectedRoute: QuoteTuple;
  allRoutes: QuoteTuple[];
  marketMetrics: {
    priceSpread: number;
    priceSpreadPercentage: number;
    averagePrice: number;
    bestOutputAmount: number;
    worstOutputAmount: number;
    averageSlippage: number;
    totalLiquidity: number;
  };
  strategyAnalysis: Record<RoutingStrategy, QuoteTuple | null>;
  recommendation: QuoteTuple;
  timestamp: string;
}

export interface UserPreferences {
  excludeDEXs?: string[];
  minLiquidity?: number;
  maxSlippage?: number;
  preferredDEX?: string;
}
