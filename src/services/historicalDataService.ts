import { Pool } from 'pg';
import { HistoricalPoolSnapshot } from '../types';
import { ValidationError, DatabaseError } from '../errors/customErrors';

type PoolSnapshotInput = Omit<HistoricalPoolSnapshot, 'id' | 'createdAt'> & {
  timestamp: Date | string;
};

interface SyntheticDataOptions {
  dexes: string[];
  tokenPairs: Array<{ tokenA: string; tokenB: string }>;
  startDate: Date | string;
  endDate: Date | string;
  intervalMinutes?: number;
  baseReserves?: number;
  basePrice?: number;
  volatility?: number;
  fee?: number;
}

export class HistoricalDataService {
  constructor(private pool: Pool) {}

  /**
   * Save an individual pool snapshot with upsert semantics.
   */
  async savePoolSnapshot(snapshot: PoolSnapshotInput): Promise<HistoricalPoolSnapshot> {
    const timestamp = this.normalizeTimestamp(snapshot.timestamp);
    const query = `
      INSERT INTO historical_pool_snapshots (
        snapshot_time,
        dex,
        token_a,
        token_b,
        reserve_a,
        reserve_b,
        total_liquidity,
        fee
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (snapshot_time, dex, token_a, token_b)
      DO UPDATE SET
        reserve_a = EXCLUDED.reserve_a,
        reserve_b = EXCLUDED.reserve_b,
        total_liquidity = EXCLUDED.total_liquidity,
        fee = EXCLUDED.fee
      RETURNING *;
    `;

    const values = [
      timestamp.toISOString(),
      snapshot.dex,
      snapshot.tokenA,
      snapshot.tokenB,
      snapshot.reserveA,
      snapshot.reserveB,
      snapshot.totalLiquidity,
      snapshot.fee,
    ];

    try {
      const result = await this.pool.query(query, values);
      return this.mapRow(result.rows[0]);
    } catch (error) {
      throw new DatabaseError('Failed to save pool snapshot', error as Error);
    }
  }

  /**
   * Retrieve the closest pool snapshot around the requested timestamp.
   */
  async getPoolStateAt(
    dex: string,
    tokenA: string,
    tokenB: string,
    timestamp: Date | string
  ): Promise<HistoricalPoolSnapshot | null> {
    const normalizedTimestamp = this.normalizeTimestamp(timestamp);

    const query = `
      SELECT *
      FROM historical_pool_snapshots
      WHERE dex = $1 AND token_a = $2 AND token_b = $3
      ORDER BY ABS(EXTRACT(EPOCH FROM snapshot_time) - EXTRACT(EPOCH FROM $4::timestamp)) ASC
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [
      dex,
      tokenA,
      tokenB,
      normalizedTimestamp.toISOString(),
    ]);

    if (result.rowCount === 0) {
      return null;
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Retrieve all snapshots for a pair within a range.
   */
  async getPoolStatesInRange(
    dex: string,
    tokenA: string,
    tokenB: string,
    startDate: Date | string,
    endDate: Date | string
  ): Promise<HistoricalPoolSnapshot[]> {
    const start = this.normalizeTimestamp(startDate);
    const end = this.normalizeTimestamp(endDate);

    if (start >= end) {
      throw new ValidationError('Start date must be earlier than end date');
    }

    const query = `
      SELECT *
      FROM historical_pool_snapshots
      WHERE dex = $1
        AND token_a = $2
        AND token_b = $3
        AND snapshot_time BETWEEN $4 AND $5
      ORDER BY snapshot_time ASC;
    `;

    const result = await this.pool.query(query, [
      dex,
      tokenA,
      tokenB,
      start.toISOString(),
      end.toISOString(),
    ]);

    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Insert multiple snapshots efficiently using a single statement.
   */
  async bulkSaveSnapshots(snapshots: PoolSnapshotInput[]): Promise<HistoricalPoolSnapshot[]> {
    if (snapshots.length === 0) {
      return [];
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const values: any[] = [];
      const placeholders: string[] = [];

      snapshots.forEach((snapshot, index) => {
        const baseIndex = index * 8;
        placeholders.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8})`
        );
        const timestamp = this.normalizeTimestamp(snapshot.timestamp);
        values.push(
          timestamp.toISOString(),
          snapshot.dex,
          snapshot.tokenA,
          snapshot.tokenB,
          snapshot.reserveA,
          snapshot.reserveB,
          snapshot.totalLiquidity,
          snapshot.fee
        );
      });

      const query = `
        INSERT INTO historical_pool_snapshots (
          snapshot_time,
          dex,
          token_a,
          token_b,
          reserve_a,
          reserve_b,
          total_liquidity,
          fee
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (snapshot_time, dex, token_a, token_b)
        DO UPDATE SET
          reserve_a = EXCLUDED.reserve_a,
          reserve_b = EXCLUDED.reserve_b,
          total_liquidity = EXCLUDED.total_liquidity,
          fee = EXCLUDED.fee
        RETURNING *;
      `;

      const result = await client.query(query, values);
      await client.query('COMMIT');
      return result.rows.map((row) => this.mapRow(row));
    } catch (error) {
      await client.query('ROLLBACK');
      throw new DatabaseError('Failed to bulk save pool snapshots', error as Error);
    } finally {
      client.release();
    }
  }

  /**
   * Generate synthetic historical pool data via random walk simulation.
   */
  async generateSyntheticData(options: SyntheticDataOptions): Promise<HistoricalPoolSnapshot[]> {
    if (!options.dexes.length || !options.tokenPairs.length) {
      throw new ValidationError('dexes and tokenPairs are required for synthetic data generation');
    }

    const start = this.normalizeTimestamp(options.startDate);
    const end = this.normalizeTimestamp(options.endDate);

    if (start >= end) {
      throw new ValidationError('Synthetic data range is invalid');
    }

    const intervalMs = (options.intervalMinutes ?? 60) * 60 * 1000;
    if (intervalMs <= 0) {
      throw new ValidationError('Interval must be a positive number');
    }

    const baseReserves = options.baseReserves ?? 3_000_000;
    const basePrice = options.basePrice ?? 50;
    const volatility = options.volatility ?? 0.02;
    const fee = options.fee ?? 0.003;

    const priceState = new Map<string, number>();
    const snapshots: PoolSnapshotInput[] = [];

    for (let ts = start.getTime(); ts <= end.getTime(); ts += intervalMs) {
      options.dexes.forEach((dex) => {
        options.tokenPairs.forEach((pair) => {
          const key = `${dex}-${pair.tokenA}-${pair.tokenB}`;
          const currentPrice = priceState.get(key) ?? basePrice;
          const shock = (Math.random() * 2 - 1) * volatility;
          const nextPrice = Math.max(0.0001, currentPrice * (1 + shock));
          priceState.set(key, nextPrice);

          const reserveA = baseReserves * (0.9 + Math.random() * 0.2);
          const reserveB = reserveA * nextPrice;

          snapshots.push({
            timestamp: new Date(ts).toISOString(),
            dex,
            tokenA: pair.tokenA,
            tokenB: pair.tokenB,
            reserveA,
            reserveB,
            totalLiquidity: reserveA * nextPrice * 2,
            fee,
          });
        });
      });
    }

    return this.bulkSaveSnapshots(snapshots);
  }

  private mapRow(row: any): HistoricalPoolSnapshot {
    return {
      id: row.id,
      timestamp: row.snapshot_time instanceof Date ? row.snapshot_time.toISOString() : row.snapshot_time,
      dex: row.dex,
      tokenA: row.token_a,
      tokenB: row.token_b,
      reserveA: Number(row.reserve_a),
      reserveB: Number(row.reserve_b),
      totalLiquidity: Number(row.total_liquidity),
      fee: Number(row.fee),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  }

  private normalizeTimestamp(value: Date | string): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError('Invalid date provided for historical snapshot');
    }
    return date;
  }
}

