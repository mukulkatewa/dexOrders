import { AutoTradingBot, BotConfig } from './autoTradingBot';

export class BotManager {
  private activeBots: Map<string, AutoTradingBot> = new Map();

  // Start a new trading bot with given config
  async startBot(config: BotConfig) {
    if (this.activeBots.has(config.id)) {
      throw new Error('Bot already running');
    }

    const bot = new AutoTradingBot(config);
    this.activeBots.set(config.id, bot);
    bot.start();
    console.log(`Bot ${config.id} started`);
  }

  // Stop bot and remove
  stopBot(botId: string) {
    const bot = this.activeBots.get(botId);
    if (bot) {
      bot.stop();
      this.activeBots.delete(botId);
      console.log(`Bot ${botId} stopped`);
    } else {
      console.log(`Bot ${botId} not found`);
    }
  }

  // Get count of active bots
  getActiveBotsCount() {
    return this.activeBots.size;
  }
}
