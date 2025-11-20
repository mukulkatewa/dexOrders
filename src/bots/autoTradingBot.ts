import WebSocket from "ws";
import { DexQuote, MockDexRouter } from "../services/mockDexRouter";

export interface BotConfig {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  triggerCondition: "below" | "above";
  targetPrice: number;
}

export class AutoTradingBot {
  private router = new MockDexRouter();
  private interval: NodeJS.Timeout | null = null;

  constructor(private config: BotConfig) {}

  start() {
    console.log(
      `AutoTradingBot started for ${this.config.tokenIn} -> ${this.config.tokenOut}`
    );

    this.interval = setInterval(async () => {
      try {
        // Get a quote and simulate Raydium quote by forcing dex filter
        const allQuotes: DexQuote[] = [];
        // Get multiple quotes so we can choose the desired dex for each
        for (let i = 0; i < 5; i++) {
          const quote = await this.router.getBestQuote(
            this.config.tokenIn,
            this.config.tokenOut,
            this.config.amountIn
          );
          allQuotes.push(quote);
        }

        // Filter quotes for Raydium and Meteora by dex name (mock simulation)
        const raydiumQuote =
          allQuotes.find((q) => q.dex === "raydium") || allQuotes[0];
        const meteoraQuote =
          allQuotes.find((q) => q.dex === "meteora") || allQuotes[0];

        // For demo, pick max price from fetched quotes per dex
        // Better to refactor getBestQuote method in future to return specific dex prices
        const bestPrice = Math.max(raydiumQuote.price, meteoraQuote.price);

        console.log(
          `Raydium price: ${raydiumQuote.price.toFixed(
            6
          )}, Meteora price: ${meteoraQuote.price.toFixed(
            6
          )}, Best: ${bestPrice.toFixed(6)}, Target: ${this.config.targetPrice}`
        );

        const triggered =
          (this.config.triggerCondition === "below" &&
            bestPrice <= this.config.targetPrice) ||
          (this.config.triggerCondition === "above" &&
            bestPrice >= this.config.targetPrice);

        if (triggered) {
          console.log("Price condition met! Executing order...");
          await this.executeOrder();
          this.stop();
        }
      } catch (error) {
        console.error("Error during price monitoring:", error);
      }
    }, 5000);
  }

  private async executeOrder(): Promise<void> {
    try {
      // First, create the order via HTTP POST
      const response = await fetch("http://localhost:3000/api/orders/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokenIn: this.config.tokenIn,
          tokenOut: this.config.tokenOut,
          amountIn: this.config.amountIn,
          orderType: "market",
          routingStrategy: "BEST_PRICE",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create order: ${response.statusText}`);
      }

      const orderData = (await response.json()) as {
        orderId: string;
        status: string;
        message?: string;
      };
      const orderId = orderData.orderId;

      if (!orderId) {
        throw new Error("No orderId returned from server");
      }

      console.log(`Order created: ${orderId}, connecting to WebSocket...`);

      // Then connect to WebSocket with the orderId
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(
          `ws://localhost:3000/api/orders/execute?orderId=${orderId}`
        );

        ws.on("open", () => {
          console.log("WebSocket connected for order:", orderId);
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          console.log("WebSocket message:", msg);
          if (msg.status === "confirmed") {
            console.log("Order confirmed:", orderId);
            ws.close();
            resolve();
          } else if (msg.status === "error" || msg.error) {
            reject(new Error(msg.message || msg.error));
          }
        });

        ws.on("error", (err) => {
          console.error("WebSocket error:", err);
          reject(err);
        });

        ws.on("close", () => {
          console.log("WebSocket closed for order:", orderId);
        });
      });
    } catch (error) {
      console.error("Error executing order:", error);
      throw error;
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      console.log("AutoTradingBot stopped");
    }
  }
}
