import { BacktestTrade, PerformanceMetrics } from '../types';

export class PerformanceAnalyzer {
  private readonly annualRiskFreeRate = 0.02;

  /**
   * Aggregate method that produces every performance metric from trade data.
   */
  calculateMetrics(trades: BacktestTrade[], initialCapital: number): PerformanceMetrics {
    if (initialCapital <= 0 || !Number.isFinite(initialCapital)) {
      throw new Error('Initial capital must be a positive, finite number');
    }

    if (!Array.isArray(trades)) {
      throw new Error('Trades payload must be an array');
    }

    const returns = trades.map((trade) => trade.returnPercent);
    const portfolioValues =
      trades.length > 0 ? trades.map((trade) => trade.portfolioValue) : [initialCapital];

    const finalValue = portfolioValues[portfolioValues.length - 1];

    const totalReturn = this.calculateTotalReturn(initialCapital, finalValue);
    const avgReturn = this.calculateAvgReturn(returns);
    const sharpeRatio = this.calculateSharpeRatio(returns, this.annualRiskFreeRate);
    const maxDrawdown = this.calculateMaxDrawdown(portfolioValues);
    const winRate = this.calculateWinRate(trades);
    const profitFactor = this.calculateProfitFactor(trades);
    const avgWinningTrade = this.calculateAvgWinningTrade(trades);
    const avgLosingTrade = this.calculateAvgLosingTrade(trades);

    return {
      totalReturn,
      sharpeRatio,
      maxDrawdown,
      winRate,
      totalTrades: trades.length,
      profitFactor,
      avgReturn,
      avgWinningTrade,
      avgLosingTrade,
    };
  }

  /**
   * Simple total return calculation ((final - initial) / initial).
   */
  calculateTotalReturn(initialValue: number, finalValue: number): number {
    if (initialValue <= 0) {
      throw new Error('Initial value must be positive');
    }
    return (finalValue - initialValue) / initialValue;
  }

  /**
   * Annualized Sharpe ratio using trade returns (assumes returns are already per-period).
   */
  calculateSharpeRatio(returns: number[], riskFreeRate: number): number {
    if (!returns.length) {
      return 0;
    }

    const avgReturn = this.calculateAvgReturn(returns);
    const stdDev = this.standardDeviation(returns);

    if (stdDev === 0) {
      return 0;
    }

    const excessReturn = avgReturn - riskFreeRate;
    const ratio = excessReturn / stdDev;
    return Number.isFinite(ratio) ? ratio : 0;
  }

  /**
   * Maximum peak-to-trough decline in portfolio value.
   */
  calculateMaxDrawdown(portfolioValues: number[]): number {
    if (!portfolioValues.length) {
      return 0;
    }

    let peak = portfolioValues[0];
    let maxDrawdown = 0;

    for (const value of portfolioValues) {
      peak = Math.max(peak, value);
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Ratio of winning trades to total trades.
   */
  calculateWinRate(trades: BacktestTrade[]): number {
    if (!trades.length) {
      return 0;
    }
    const winners = trades.filter((trade) => trade.pnl > 0).length;
    return winners / trades.length;
  }

  /**
   * Profit factor = sum of wins / absolute sum of losses.
   */
  calculateProfitFactor(trades: BacktestTrade[]): number {
    const wins = trades
      .filter((trade) => trade.pnl > 0)
      .reduce((total, trade) => total + trade.pnl, 0);
    const losses = trades
      .filter((trade) => trade.pnl < 0)
      .reduce((total, trade) => total + trade.pnl, 0);

    if (losses === 0) {
      return wins > 0 ? Number.MAX_VALUE : 0;
    }

    const factor = wins / Math.abs(losses);
    return Number.isFinite(factor) ? factor : 0;
  }

  /**
   * Average return across all trades.
   */
  calculateAvgReturn(returns: number[]): number {
    if (!returns.length) {
      return 0;
    }
    const total = returns.reduce((sum, value) => sum + value, 0);
    return total / returns.length;
  }

  /**
   * Average profit of winning trades.
   */
  calculateAvgWinningTrade(trades: BacktestTrade[]): number {
    const winners = trades.filter((trade) => trade.pnl > 0);
    if (!winners.length) {
      return 0;
    }
    const total = winners.reduce((sum, trade) => sum + trade.pnl, 0);
    return total / winners.length;
  }

  /**
   * Average loss of losing trades (negative value).
   */
  calculateAvgLosingTrade(trades: BacktestTrade[]): number {
    const losers = trades.filter((trade) => trade.pnl < 0);
    if (!losers.length) {
      return 0;
    }
    const total = losers.reduce((sum, trade) => sum + trade.pnl, 0);
    return total / losers.length;
  }

  /**
   * Standard deviation helper used across calculations.
   */
  standardDeviation(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }
    const mean = this.calculateAvgReturn(values);
    const variance =
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
    const stdDev = Math.sqrt(variance);
    return Number.isFinite(stdDev) ? stdDev : 0;
  }
}

