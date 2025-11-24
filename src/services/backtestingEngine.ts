import { HistoricalDataService } from './historicalDataService';
import { RoutingHub } from './hub';
import { MockDexRouter } from './mockDexRouter';
import { BacktestRepository, BacktestTradeInput } from '../repositories/backtestRepository';
import { PerformanceAnalyzer } from './performanceAnalyzer';
import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  HistoricalPoolSnapshot,
} from '../types';
import { ValidationError } from '../errors/customErrors';

type IntervalKey = '1m' | '5m' | '1h' | '1d';

interface SimulatedOrder {
  executedAt: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  selectedDex: string;
  executionPrice: number;
  slippage: number;
  pnl: number;
  cost: number;
}

export class BacktestingEngine {
  private readonly intervalMs: Record<IntervalKey, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };

  constructor(
    private historicalDataService: HistoricalDataService,
    private routingHub: RoutingHub,
    private mockDexRouter: MockDexRouter,
    private backtestRepository: BacktestRepository,
    private performanceAnalyzer: PerformanceAnalyzer
  ) {}

  /**
   * Primary orchestration method that runs an end-to-end backtest.
   */
  async runBacktest(config: BacktestConfig, preExistingRunId?: string): Promise<BacktestResult> {
    this.validateConfig(config);
    const runId = preExistingRunId ?? (await this.backtestRepository.createRun(config));
    const logPrefix = preExistingRunId ? 'Queued run' : 'Created run';
    console.log(`[BacktestingEngine] ${logPrefix} ${runId} for strategy ${config.strategy}`);

    const timestamps = this.getTimeRange(config);
    const trades: BacktestTradeInput[] = [];
    const equityCurve: EquityPoint[] = [];
    let portfolioValue = config.initialCapital;

    try {
      for (let index = 0; index < timestamps.length; index++) {
        const timestamp = timestamps[index];
        if (index % 10 === 0 || index === timestamps.length - 1) {
          console.log(
            `[BacktestingEngine] Progress ${index + 1}/${timestamps.length} (${timestamp.toISOString()})`
          );
        }

        const snapshots = await this.updatePoolStates(timestamp, config.tokenPair);
        if (!snapshots.length) {
          console.warn(
            `[BacktestingEngine] No historical liquidity for ${config.tokenPair.tokenIn}/${config.tokenPair.tokenOut} at ${timestamp.toISOString()}`
          );
          this.buildEquityCurve(equityCurve, timestamp, portfolioValue);
          continue;
        }

        const simulated = await this.simulateOrder(config, timestamp, portfolioValue);
        if (!simulated) {
          this.buildEquityCurve(equityCurve, timestamp, portfolioValue);
          continue;
        }

        const updatedPortfolio = this.updatePortfolio(portfolioValue, simulated.pnl);
        const returnPercent = simulated.cost === 0 ? 0 : simulated.pnl / simulated.cost;

        trades.push({
          executedAt: simulated.executedAt,
          tokenIn: simulated.tokenIn,
          tokenOut: simulated.tokenOut,
          amountIn: simulated.amountIn,
          amountOut: simulated.amountOut,
          selectedDex: simulated.selectedDex,
          executionPrice: simulated.executionPrice,
          slippage: simulated.slippage,
          pnl: simulated.pnl,
          returnPercent,
          portfolioValue: updatedPortfolio,
        });

        portfolioValue = updatedPortfolio;
        this.buildEquityCurve(equityCurve, timestamp, portfolioValue);
      }

      const tradesForMetrics: BacktestTrade[] = trades.map((trade, idx) => ({
        ...trade,
        id: `${runId}-${idx}`,
        backtestRunId: runId,
      }));

      const metrics = this.performanceAnalyzer.calculateMetrics(tradesForMetrics, config.initialCapital);
      const result = await this.backtestRepository.saveResult(runId, {
        finalCapital: portfolioValue,
        metrics,
        equityCurve,
        trades,
      });

      console.log(
        `[BacktestingEngine] Backtest ${runId} completed: return=${(metrics.totalReturn * 100).toFixed(2)}%`
      );
      return result;
    } catch (error) {
      console.error(`[BacktestingEngine] Backtest ${runId} failed`, error);
      await this.backtestRepository.markFailed(
        runId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Validate user-provided configuration prior to running.
   */
  private validateConfig(config: BacktestConfig): void {
    if (!config.name || !config.name.trim()) {
      throw new ValidationError('Backtest name is required');
    }

    if (config.initialCapital <= 0) {
      throw new ValidationError('Initial capital must be positive');
    }

    if (config.tradeSize <= 0) {
      throw new ValidationError('Trade size must be positive');
    }

    if (!(config.interval in this.intervalMs)) {
      throw new ValidationError('Unsupported interval');
    }

    if (config.maxSlippage < 0 || config.maxSlippage > 1) {
      throw new ValidationError('Max slippage must be between 0 and 1');
    }

    const start = config.startDate instanceof Date ? config.startDate : new Date(config.startDate);
    const end = config.endDate instanceof Date ? config.endDate : new Date(config.endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ValidationError('Invalid date range');
    }

    if (start >= end) {
      throw new ValidationError('Start date must be earlier than end date');
    }
  }

  /**
   * Generate an array of timestamps spaced by the config interval.
   */
  private getTimeRange(config: BacktestConfig): Date[] {
    const ms = this.intervalMs[config.interval];
    const start = config.startDate instanceof Date ? config.startDate : new Date(config.startDate);
    const end = config.endDate instanceof Date ? config.endDate : new Date(config.endDate);

    const result: Date[] = [];
    for (let ts = start.getTime(); ts <= end.getTime(); ts += ms) {
      result.push(new Date(ts));
    }
    return result;
  }

  /**
   * Apply historical liquidity snapshots to the mock router pools.
   */
  private async updatePoolStates(
    timestamp: Date,
    tokenPair: BacktestConfig['tokenPair']
  ): Promise<HistoricalPoolSnapshot[]> {
    const dexes = this.mockDexRouter.getSupportedDexes();
    const snapshots: HistoricalPoolSnapshot[] = [];

    for (const dex of dexes) {
      const snapshot = await this.historicalDataService.getPoolStateAt(
        dex,
        tokenPair.tokenIn,
        tokenPair.tokenOut,
        timestamp
      );
      if (snapshot) {
        this.mockDexRouter.updatePoolFromSnapshot(snapshot);
        snapshots.push(snapshot);
      }
    }

    return snapshots;
  }

  /**
   * Simulate a single trade execution using routing + AMM data.
   * Note: tradeSize is in tokenIn units, portfolio is tracked in tokenOut (base currency).
   */
  private async simulateOrder(
    config: BacktestConfig,
    timestamp: Date,
    currentPortfolio: number
  ): Promise<SimulatedOrder | null> {
    let amountIn = config.tradeSize; // Amount in tokenIn units (e.g., SOL)
    let quotes = await this.mockDexRouter.getQuotes(
      config.tokenPair.tokenIn,
      config.tokenPair.tokenOut,
      amountIn
    );

    if (!quotes.length) {
      return null;
    }

    let bestQuote = this.routingHub.selectBestRoute(quotes, config.strategy);

    const slippage = bestQuote.slippage ?? 0;
    if (slippage > config.maxSlippage) {
      console.warn(
        `[BacktestingEngine] Skipping trade due to slippage ${slippage} at ${timestamp.toISOString()}`
      );
      return null;
    }

    const amountOut =
      (bestQuote as any).estimatedOutput ||
      bestQuote.outputAmount ||
      bestQuote.originalQuote?.estimatedOutput;
    if (!amountOut || amountOut <= 0) {
      return null;
    }

    // Cost in base currency (tokenOut): amountIn * price
    // Price is tokenOut per tokenIn (e.g., USDC per SOL)
    const cost = bestQuote.price * amountIn;
    
    // Check if we have enough portfolio value to cover the cost
    if (cost > currentPortfolio) {
      // Adjust amountIn to fit available portfolio
      amountIn = currentPortfolio / Math.max(bestQuote.price, 1e-9);
      if (amountIn <= 0) {
        return null;
      }
      quotes = await this.mockDexRouter.getQuotes(
        config.tokenPair.tokenIn,
        config.tokenPair.tokenOut,
        amountIn
      );
      if (!quotes.length) {
        return null;
      }
      bestQuote = this.routingHub.selectBestRoute(quotes, config.strategy);
      const adjustedAmountOut =
        (bestQuote as any).estimatedOutput ||
        bestQuote.outputAmount ||
        bestQuote.originalQuote?.estimatedOutput;
      if (!adjustedAmountOut || adjustedAmountOut <= 0) {
        return null;
      }
      
      // Recalculate with adjusted amounts
      const adjustedCost = bestQuote.price * amountIn;
      const pnl = adjustedAmountOut - adjustedCost;
      
      return {
        executedAt: timestamp.toISOString(),
        tokenIn: config.tokenPair.tokenIn,
        tokenOut: config.tokenPair.tokenOut,
        amountIn,
        amountOut: adjustedAmountOut,
        selectedDex:
          bestQuote.provider || (bestQuote as any).dex || config.strategy || "unknown",
        executionPrice: bestQuote.price,
        slippage,
        pnl,
        cost: adjustedCost,
      };
    }

    // PnL = value received - value spent (both in base currency)
    const pnl = amountOut - cost;

    return {
      executedAt: timestamp.toISOString(),
      tokenIn: config.tokenPair.tokenIn,
      tokenOut: config.tokenPair.tokenOut,
      amountIn,
      amountOut,
      selectedDex:
        bestQuote.provider || (bestQuote as any).dex || config.strategy || "unknown",
      executionPrice: bestQuote.price,
      slippage,
      pnl,
      cost,
    };
  }

  /**
   * Simple cash portfolio updater.
   */
  private updatePortfolio(currentValue: number, pnl: number): number {
    return currentValue + pnl;
  }

  /**
   * Append a new equity point for visualization.
   */
  private buildEquityCurve(
    curve: EquityPoint[],
    timestamp: Date,
    portfolioValue: number
  ): void {
    curve.push({
      timestamp: timestamp.toISOString(),
      portfolioValue,
    });
  }
}

