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
