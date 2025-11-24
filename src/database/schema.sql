CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(255) PRIMARY KEY,
  token_in VARCHAR(50) NOT NULL,
  token_out VARCHAR(50) NOT NULL,
  amount_in NUMERIC(20, 8) NOT NULL,
  amount_out NUMERIC(20, 8),
  order_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  selected_dex VARCHAR(50),
  execution_price NUMERIC(20, 8),
  tx_hash VARCHAR(255),
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Stores high-level configuration and results for each backtest run
CREATE TABLE IF NOT EXISTS backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  strategy VARCHAR(50) NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  initial_capital NUMERIC(20, 4) NOT NULL,
  final_capital NUMERIC(20, 4),
  total_return NUMERIC(10, 6),
  sharpe_ratio NUMERIC(10, 6),
  max_drawdown NUMERIC(10, 6),
  win_rate NUMERIC(10, 6),
  total_trades INTEGER,
  profit_factor NUMERIC(10, 6),
  avg_return NUMERIC(10, 6),
  avg_winning_trade NUMERIC(20, 6),
  avg_losing_trade NUMERIC(20, 6),
  equity_curve JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON backtest_runs(strategy);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_status ON backtest_runs(status);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_dates ON backtest_runs(start_date, end_date);

-- Stores every trade generated during a backtest
CREATE TABLE IF NOT EXISTS backtest_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_run_id UUID NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  executed_at TIMESTAMP NOT NULL,
  token_in VARCHAR(50) NOT NULL,
  token_out VARCHAR(50) NOT NULL,
  amount_in NUMERIC(20, 8) NOT NULL,
  amount_out NUMERIC(20, 8) NOT NULL,
  selected_dex VARCHAR(50) NOT NULL,
  execution_price NUMERIC(20, 8) NOT NULL,
  slippage NUMERIC(10, 6) NOT NULL,
  pnl NUMERIC(20, 6) NOT NULL,
  return_percent NUMERIC(10, 6) NOT NULL,
  portfolio_value NUMERIC(20, 4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(backtest_run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_time ON backtest_trades(executed_at);

-- Stores historical liquidity pool snapshots used during backtesting
CREATE TABLE IF NOT EXISTS historical_pool_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_time TIMESTAMP NOT NULL,
  dex VARCHAR(50) NOT NULL,
  token_a VARCHAR(50) NOT NULL,
  token_b VARCHAR(50) NOT NULL,
  reserve_a NUMERIC(30, 10) NOT NULL,
  reserve_b NUMERIC(30, 10) NOT NULL,
  total_liquidity NUMERIC(30, 10) NOT NULL,
  fee NUMERIC(10, 6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_time, dex, token_a, token_b)
);

CREATE INDEX IF NOT EXISTS idx_pool_snapshots_time ON historical_pool_snapshots(snapshot_time);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pair ON historical_pool_snapshots(dex, token_a, token_b);