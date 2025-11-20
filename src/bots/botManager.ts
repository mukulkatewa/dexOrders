import { AutoTradingBot, BotConfig } from "./autoTradingBot";

export class BotManager {
  private activeBots: Map<string, AutoTradingBot> = new Map();
  private botConfigs: Map<string, BotConfig> = new Map();

  // Start a new trading bot with given config
  async startBot(config: BotConfig) {
    if (this.activeBots.has(config.id)) {
      throw new Error("Bot already running");
    }

    const bot = new AutoTradingBot(config);
    this.activeBots.set(config.id, bot);
    this.botConfigs.set(config.id, config);
    bot.start();
    console.log(`Bot ${config.id} started`);
  }

  // Stop bot and remove
  stopBot(botId: string): boolean {
    const bot = this.activeBots.get(botId);
    if (bot) {
      bot.stop();
      this.activeBots.delete(botId);
      this.botConfigs.delete(botId);
      console.log(`Bot ${botId} stopped`);
      return true;
    } else {
      console.log(`Bot ${botId} not found`);
      return false;
    }
  }

  // Get count of active bots
  getActiveBotsCount() {
    return this.activeBots.size;
  }

  // Get configs for all active bots
  getActiveBotConfigs(): BotConfig[] {
    return Array.from(this.botConfigs.values());
  }
}
