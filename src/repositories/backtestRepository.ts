import { Pool, PoolClient } from 'pg';
import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  PerformanceMetrics,
} from '../types';
import { DatabaseError, NotFoundError } from '../errors/customErrors';

export interface ListRunFilters {
  strategy?: string;
  status?: string;
  startDate?: Date | string;
  endDate?: Date | string;
}

export type BacktestTradeInput = Omit<BacktestTrade, 'id' | 'backtestRunId'>;

interface SaveResultParams {
  finalCapital: number;
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTradeInput[];
  status?: string;
}

export class BacktestRepository {
  constructor(private pool: Pool) {}

  /**
   * Insert a new backtest run placeholder and return its UUID.
   */
  async createRun(config: BacktestConfig): Promise<string> {
    const query = `
      INSERT INTO backtest_runs (
        name,
        strategy,
        start_date,
        end_date,
        initial_capital,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'running')
      RETURNING id;
    `;

    const result = await this.pool.query(query, [
      config.name,
      config.strategy,
      config.startDate,
      config.endDate,
      config.initialCapital,
    ]);

    return result.rows[0].id;
  }

  /**
   * Persist final run metrics and trade set atomically.
   */
  async saveResult(runId: string, params: SaveResultParams): Promise<BacktestResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const updateQuery = `
        UPDATE backtest_runs
        SET
          final_capital = $1,
          total_return = $2,
          sharpe_ratio = $3,
          max_drawdown = $4,
          win_rate = $5,
          total_trades = $6,
          profit_factor = $7,
          avg_return = $8,
          avg_winning_trade = $9,
          avg_losing_trade = $10,
          equity_curve = $11,
          status = $12,
          updated_at = NOW()
        WHERE id = $13
        RETURNING *;
      `;

      const metrics = params.metrics;
      const status = params.status ?? 'completed';

      const updateResult = await client.query(updateQuery, [
        params.finalCapital,
        metrics.totalReturn,
        metrics.sharpeRatio,
        metrics.maxDrawdown,
        metrics.winRate,
        metrics.totalTrades,
        metrics.profitFactor,
        metrics.avgReturn,
        metrics.avgWinningTrade,
        metrics.avgLosingTrade,
        JSON.stringify(params.equityCurve),
        status,
        runId,
      ]);

      if (updateResult.rowCount === 0) {
        throw new NotFoundError('Backtest run', runId);
      }

      let trades: BacktestTrade[] = [];
      if (params.trades.length > 0) {
        trades = await this.insertTrades(client, runId, params.trades);
      } else {
        // Fetch existing trades using transaction client for consistency
        const tradesQuery = `
          SELECT *
          FROM backtest_trades
          WHERE backtest_run_id = $1
          ORDER BY executed_at ASC
          LIMIT $2 OFFSET $3;
        `;
        const tradesResult = await client.query(tradesQuery, [runId, 10_000, 0]);
        trades = tradesResult.rows.map((row) => this.mapTradeRow(row));
      }

      await client.query('COMMIT');

      const runRow = updateResult.rows[0];
      return this.mapRunRow(runRow, trades);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new DatabaseError('Failed to save backtest result', error as Error);
    } finally {
      client.release();
    }
  }

  /**
   * Bulk insert trades for a given run (without updating run record).
   */
  async saveTrades(runId: string, trades: BacktestTradeInput[]): Promise<BacktestTrade[]> {
    if (trades.length === 0) {
      return [];
    }

    const result = await this.insertTrades(this.pool, runId, trades);
    return result;
  }

  /**
   * Mark a run as failed with an error message.
   */
  async markFailed(runId: string, errorMessage: string): Promise<void> {
    const query = `
      UPDATE backtest_runs
      SET status = 'failed',
          error_message = $1,
          updated_at = NOW()
      WHERE id = $2;
    `;

    await this.pool.query(query, [errorMessage, runId]);
  }

  /**
   * Retrieve a full run result and its trades.
   */
  async getResult(runId: string): Promise<BacktestResult> {
    const runQuery = 'SELECT * FROM backtest_runs WHERE id = $1';
    const runResult = await this.pool.query(runQuery, [runId]);

    if (runResult.rowCount === 0) {
      throw new NotFoundError('Backtest run', runId);
    }

    const expectedTrades = Number(runResult.rows[0].total_trades) || 0;
    const limit = expectedTrades > 0 ? expectedTrades : 10_000;
    const trades = await this.getTrades(runId, limit, 0);
    return this.mapRunRow(runResult.rows[0], trades);
  }

  /**
   * Fetch paginated trades for a run.
   */
  async getTrades(runId: string, limit: number, offset: number): Promise<BacktestTrade[]> {
    const query = `
      SELECT *
      FROM backtest_trades
      WHERE backtest_run_id = $1
      ORDER BY executed_at ASC
      LIMIT $2 OFFSET $3;
    `;

    const result = await this.pool.query(query, [runId, limit, offset]);
    return result.rows.map((row) => this.mapTradeRow(row));
  }

  /**
   * List runs with optional strategy/status/date filters.
   */
  async listRuns(filters: ListRunFilters = {}): Promise<BacktestResult[]> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (filters.strategy) {
      values.push(filters.strategy);
      conditions.push(`strategy = $${values.length}`);
    }

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }

    if (filters.startDate) {
      values.push(filters.startDate);
      conditions.push(`start_date >= $${values.length}`);
    }

    if (filters.endDate) {
      values.push(filters.endDate);
      conditions.push(`end_date <= $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT *
      FROM backtest_runs
      ${whereClause}
      ORDER BY created_at DESC;
    `;

    const result = await this.pool.query(query, values);
    return result.rows.map((row) => this.mapRunRow(row, []));
  }

  /**
   * Compare multiple runs by returning key summary metrics.
   */
  async compareRuns(runIds: string[]): Promise<
    Array<{
      id: string;
      name: string;
      strategy: string;
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      winRate: number;
      finalCapital: number | null;
    }>
  > {
    if (runIds.length === 0) {
      return [];
    }

    const query = `
      SELECT
        id,
        name,
        strategy,
        total_return,
        sharpe_ratio,
        max_drawdown,
        win_rate,
        final_capital
      FROM backtest_runs
      WHERE id = ANY($1);
    `;

    const result = await this.pool.query(query, [runIds]);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      strategy: row.strategy,
      totalReturn: Number(row.total_return) || 0,
      sharpeRatio: Number(row.sharpe_ratio) || 0,
      maxDrawdown: Number(row.max_drawdown) || 0,
      winRate: Number(row.win_rate) || 0,
      finalCapital:
        row.final_capital === null || row.final_capital === undefined
          ? null
          : Number(row.final_capital),
    }));
  }

  /**
   * Delete a run and cascade trades.
   */
  async deleteRun(runId: string): Promise<void> {
    const result = await this.pool.query('DELETE FROM backtest_runs WHERE id = $1 RETURNING id', [
      runId,
    ]);
    if (result.rowCount === 0) {
      throw new NotFoundError('Backtest run', runId);
    }
  }

  private async insertTrades(
    executor: Pool | PoolClient,
    runId: string,
    trades: BacktestTradeInput[]
  ): Promise<BacktestTrade[]> {
    const values: any[] = [];
    const placeholders: string[] = [];

    trades.forEach((trade, index) => {
      const base = index * 12;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`
      );
      values.push(
        runId,
        trade.executedAt,
        trade.tokenIn,
        trade.tokenOut,
        trade.amountIn,
        trade.amountOut,
        trade.selectedDex,
        trade.executionPrice,
        trade.slippage,
        trade.pnl,
        trade.returnPercent,
        trade.portfolioValue
      );
    });

    const insertQuery = `
      INSERT INTO backtest_trades (
        backtest_run_id,
        executed_at,
        token_in,
        token_out,
        amount_in,
        amount_out,
        selected_dex,
        execution_price,
        slippage,
        pnl,
        return_percent,
        portfolio_value
      ) VALUES ${placeholders.join(', ')}
      RETURNING *;
    `;

    const result = await executor.query(insertQuery, values);
    return result.rows.map((row: any) => this.mapTradeRow(row));
  }

  private mapRunRow(row: any, trades: BacktestTrade[]): BacktestResult {
    const metrics: PerformanceMetrics = {
      totalReturn: Number(row.total_return) || 0,
      sharpeRatio: Number(row.sharpe_ratio) || 0,
      maxDrawdown: Number(row.max_drawdown) || 0,
      winRate: Number(row.win_rate) || 0,
      totalTrades: Number(row.total_trades) || 0,
      profitFactor: Number(row.profit_factor) || 0,
      avgReturn: Number(row.avg_return) || 0,
      avgWinningTrade: Number(row.avg_winning_trade) || 0,
      avgLosingTrade: Number(row.avg_losing_trade) || 0,
    };

    const equityCurve: EquityPoint[] = Array.isArray(row.equity_curve)
      ? row.equity_curve
      : row.equity_curve
      ? JSON.parse(row.equity_curve)
      : [];

    return {
      id: row.id,
      name: row.name,
      strategy: row.strategy,
      startDate: row.start_date instanceof Date ? row.start_date.toISOString() : String(row.start_date),
      endDate: row.end_date instanceof Date ? row.end_date.toISOString() : String(row.end_date),
      initialCapital: Number(row.initial_capital),
      finalCapital:
        row.final_capital !== null && row.final_capital !== undefined
          ? Number(row.final_capital)
          : Number(row.initial_capital),
      metrics,
      trades,
      equityCurve,
      status: row.status,
      totalTrades: metrics.totalTrades,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      errorMessage: row.error_message || undefined,
    };
  }

  private mapTradeRow(row: any): BacktestTrade {
    return {
      id: row.id,
      backtestRunId: row.backtest_run_id,
      executedAt: row.executed_at instanceof Date ? row.executed_at.toISOString() : row.executed_at,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amountIn: Number(row.amount_in),
      amountOut: Number(row.amount_out),
      selectedDex: row.selected_dex,
      executionPrice: Number(row.execution_price),
      slippage: Number(row.slippage),
      pnl: Number(row.pnl),
      returnPercent: Number(row.return_percent),
      portfolioValue: Number(row.portfolio_value),
    };
  }
}

