/* eslint-disable prettier/prettier */
import * as fs from 'fs';
import * as path from 'path';

interface MarketData {
  timestamp: number;
  price: number;
  volume1m: number;
  volume5m: number;
  marketCap: number;
  tradeAmount: number; // Amount of tokens in the last trade
  tradeType: 'BUY' | 'SELL'; // Type of the last trade
}

interface TradingPosition {
  entryPrice: number;
  amount: number;
  timestamp: number;
}

interface TradeLog {
  timestamp: number;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  total: number;
  profitLoss?: number;
  holdTime?: number;
  dateTime?: string; // ISO string representation of the timestamp
}

export class TradingBot {
  // Volume-related thresholds
  private readonly VOLUME_SPIKE_THRESHOLD = 2.0; // Lower from 3.0 to allow more trades
  private readonly MIN_VOLUME_USD = 300;         // Reduced from 500 to capture smaller volume

  // Price movement thresholds
  private readonly PRICE_CHANGE_THRESHOLD = 0.02;  // 2%
  private readonly REVERSAL_THRESHOLD = 0.01;      // 1%

  // Risk management
  private readonly PROFIT_TARGET = 0.03; // 3% - smaller, faster profit taking
  private readonly STOP_LOSS = 0.015;    // 1.5% - tighter stop to cut losers early
  private readonly MAX_HOLD_TIME = 20;   // 20 seconds - shortened hold time for quick scalps

  // Trade execution
  private readonly TRADE_COOLDOWN = 20;  // 20 seconds between trades to reduce overtrading
  private readonly FIXED_TOKEN_AMOUNT = 1000;
  private readonly TREND_WINDOW = 3;

  // Buy pressure threshold
  private readonly MIN_BUY_PRESSURE = 0.60; // Lowered from 0.65 to trigger more buys

  private lastTradeTimestamp = 0;

  private marketData: MarketData[] = [];
  private currentPosition: TradingPosition | null = null;
  private wallet = {
    usd: 10000, // Starting with $10,000
    tokens: 0,
  };

  private readonly logFile: string;

  constructor(
    private readonly tokenId: string,
    private readonly maxPositionSize: number = 1000, // Maximum position size in USD
    private readonly priceDataWindow: number = 300   // 5 minutes of price data
  ) {
    this.logFile = path.join(process.cwd(), `trades_${tokenId}.json`);
    this.initializeLogFile();
  }

  private initializeLogFile(): void {
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, JSON.stringify([], null, 2));
    }
  }

  private logTrade(trade: TradeLog): void {
    try {
      const trades = this.readTrades();
      trades.push({
        ...trade,
        dateTime: new Date(trade.timestamp * 1000).toISOString(),
      });
      fs.writeFileSync(this.logFile, JSON.stringify(trades, null, 2));
    } catch (error) {
      console.error('Error logging trade:', error);
    }
  }

  private readTrades(): TradeLog[] {
    try {
      const content = fs.readFileSync(this.logFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Error reading trades:', error);
      return [];
    }
  }

  public updateMarketData(data: MarketData): void {
    this.marketData.push(data);
    // Keep only recent data
    this.marketData = this.marketData.filter((d) => data.timestamp - d.timestamp <= this.priceDataWindow);

    this.analyzeMarketAndTrade(data);
  }

  private analyzeMarketAndTrade(currentData: MarketData): void {
    // If we already have a position, check if we need to sell
    if (this.currentPosition) {
      if (this.shouldSell(currentData)) {
        this.executeSell(currentData);
      }
    }
    // Otherwise, check if we should buy
    else if (this.shouldBuy(currentData)) {
      this.executeBuy(currentData);
    }
  }

  private shouldBuy(currentData: MarketData): boolean {
    if (this.marketData.length < 2) return false;

    // Cooldown check
    if (currentData.timestamp - this.lastTradeTimestamp < this.TRADE_COOLDOWN) {
      return false;
    }

    // Liquidity check
    if (currentData.volume1m < this.MIN_VOLUME_USD) {
      return false;
    }

    const volumeSpike = this.detectVolumeSpikePattern(currentData);
    const priceMovement = this.detectPriceMovement(currentData);
    const buyPressure = this.calculateBuyPressure();
    const momentum = this.calculateMomentum();
    const uptrend = this.isUptrend();

    // Buy conditions
    return (
      (uptrend || buyPressure > this.MIN_BUY_PRESSURE) &&
      volumeSpike &&
      priceMovement >= this.PRICE_CHANGE_THRESHOLD &&
      momentum > 0 &&
      !this.detectReversalPattern(currentData)
    );
  }

  private shouldSell(currentData: MarketData): boolean {
    if (!this.currentPosition) return false;

    const profitLoss = (currentData.price - this.currentPosition.entryPrice) / this.currentPosition.entryPrice;
    const holdTime = currentData.timestamp - this.currentPosition.timestamp;
    const uptrend = this.isUptrend();

    return (
      profitLoss <= -this.STOP_LOSS ||          // Stop loss
      profitLoss >= this.PROFIT_TARGET ||       // Take profit
      holdTime >= this.MAX_HOLD_TIME ||         // Max hold time
      (!uptrend && this.detectReversalPattern(currentData)) ||
      (!uptrend && profitLoss > 0.02)           // Early profit if trend falters
    );
  }

  private detectVolumeSpikePattern(currentData: MarketData): boolean {
    const avgVolume = this.calculateAverageVolume();
    return currentData.volume1m > avgVolume * this.VOLUME_SPIKE_THRESHOLD;
  }

  private detectPriceMovement(currentData: MarketData): number {
    const recentPrices = this.marketData.slice(-3);
    if (recentPrices.length < 3) return 0;

    const priceChange = (currentData.price - recentPrices[0].price) / recentPrices[0].price;

    if (Math.abs(priceChange) >= this.PRICE_CHANGE_THRESHOLD) {
      console.log(`Significant price movement detected: ${(priceChange * 100).toFixed(2)}%`);
    }

    return priceChange;
  }

  private calculateBuyPressure(): number {
    const recentTrades = this.marketData.slice(-10);
    if (recentTrades.length === 0) return 0;

    const buyCount = recentTrades.filter(d => d.tradeType === 'BUY').length;
    return buyCount / recentTrades.length;
  }

  private calculateMomentum(): number {
    const prices = this.marketData.map(d => d.price);
    if (prices.length < 2) return 0;

    return prices[prices.length - 1] - prices[0];
  }

  private detectReversalPattern(currentData: MarketData): boolean {
    if (this.marketData.length < 3) return false;

    const recentData = this.marketData.slice(-3);
    const priceChanges = recentData.map((d, i) =>
      i > 0 ? (d.price - recentData[i - 1].price) / recentData[i - 1].price : 0
    );

    const wasIncreasing = priceChanges[1] > this.PRICE_CHANGE_THRESHOLD;
    const isDecreasing = priceChanges[2] < -this.PRICE_CHANGE_THRESHOLD;
    const volumeDecreasing = currentData.volume1m < recentData[1].volume1m;

    if (wasIncreasing && isDecreasing) {
      console.log(
        `Potential reversal detected: Up ${(priceChanges[1] * 100).toFixed(2)}% -> Down ${(priceChanges[2] * 100).toFixed(2)}%`
      );
    }

    return wasIncreasing && isDecreasing && volumeDecreasing;
  }

  private calculateAverageVolume(): number {
    if (this.marketData.length === 0) return 0;
    const volumes = this.marketData.map(d => d.volume1m);
    return volumes.reduce((a, b) => a + b, 0) / volumes.length;
  }

  private isUptrend(): boolean {
    if (this.marketData.length < this.TREND_WINDOW) return false;

    const recentPrices = this.marketData.slice(-this.TREND_WINDOW);
    const ema = this.calculateEMA(recentPrices.map(d => d.price), 3);
    const currentPrice = recentPrices[recentPrices.length - 1].price;

    // Check if price is above EMA and making higher lows
    let makingHigherLows = true;
    for (let i = 2; i < recentPrices.length; i++) {
      if (recentPrices[i].price < recentPrices[i - 1].price) {
        makingHigherLows = false;
        break;
      }
    }

    return currentPrice > ema && makingHigherLows;
  }

  private calculateEMA(prices: number[], period: number): number {
    const multiplier = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  private executeBuy(currentData: MarketData): void {
    const tokenAmount = this.FIXED_TOKEN_AMOUNT;
    const positionSize = tokenAmount * currentData.price;

    this.currentPosition = {
      entryPrice: currentData.price,
      amount: tokenAmount,
      timestamp: currentData.timestamp,
    };

    this.wallet.usd -= positionSize;
    this.wallet.tokens += tokenAmount;
    this.lastTradeTimestamp = currentData.timestamp;

    this.logTrade({
      timestamp: currentData.timestamp,
      type: 'BUY',
      price: currentData.price,
      amount: tokenAmount,
      total: positionSize,
    });

    console.log(`
      BUY EXECUTED
      Price: $${currentData.price.toFixed(8)}
      Amount: ${tokenAmount} tokens
      Total: $${positionSize.toFixed(2)}
      Timestamp: ${new Date(currentData.timestamp * 1000).toISOString()}
    `);
  }

  private executeSell(currentData: MarketData): void {
    if (!this.currentPosition) return;

    const saleAmount = this.currentPosition.amount * currentData.price;
    const profitLoss =
      ((currentData.price - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100;
    const holdTime = currentData.timestamp - this.currentPosition.timestamp;

    this.wallet.usd += saleAmount;
    this.wallet.tokens -= this.currentPosition.amount;

    this.logTrade({
      timestamp: currentData.timestamp,
      type: 'SELL',
      price: currentData.price,
      amount: this.currentPosition.amount,
      total: saleAmount,
      profitLoss: profitLoss, // percentage
      holdTime: holdTime,
    });

    console.log(`
      SELL EXECUTED
      Entry Price: $${this.currentPosition.entryPrice.toFixed(8)}
      Exit Price: $${currentData.price.toFixed(8)}
      Amount: ${this.currentPosition.amount} tokens
      Total: $${saleAmount.toFixed(2)}
      Profit/Loss: ${profitLoss.toFixed(2)}%
      Hold Time: ${holdTime} seconds
      Timestamp: ${new Date(currentData.timestamp * 1000).toISOString()}
    `);

    this.currentPosition = null;
  }

  public getWalletStatus(): string {
    return `
      Wallet Status:
      USD: $${this.wallet.usd.toFixed(2)}
      Tokens: ${this.wallet.tokens}
      ${this.currentPosition
        ? `Current Position: ${this.currentPosition.amount} tokens @ $${this.currentPosition.entryPrice}`
        : 'No active position'}
    `;
  }

  public getTradingStats(): string {
    const trades = this.readTrades();
    if (trades.length === 0) return 'No trades yet';

    const profits = trades
      .filter(t => t.type === 'SELL' && t.profitLoss !== undefined)
      .map(t => t.profitLoss!);

    const totalTrades = trades.length;
    // Only half the trades are sells, so for 'win rate', we compare positive sells with total sells
    const totalSells = trades.filter(t => t.type === 'SELL').length;
    const profitableTrades = profits.filter(p => p > 0).length;
    const averageProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    const maxProfit = Math.max(...profits, 0);
    const maxLoss = Math.min(...profits, 0);

    return `
      Trading Stats for ${this.tokenId}:
      Total Trades (Buy + Sell): ${totalTrades}
      Sell Trades: ${totalSells}
      Profitable Sell Trades: ${profitableTrades}
      Win Rate: ${totalSells ? ((profitableTrades / totalSells) * 100).toFixed(2) : 0}%
      Average Profit/Loss (on sells): ${averageProfit.toFixed(2)}%
      Max Profit (on single sell): ${maxProfit.toFixed(2)}%
      Max Loss (on single sell): ${maxLoss.toFixed(2)}%
      Current Balance: $${this.wallet.usd.toFixed(2)}
      Current Tokens: ${this.wallet.tokens}
    `;
  }
}
