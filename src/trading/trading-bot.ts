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
  private readonly VOLUME_SPIKE_THRESHOLD = 2.0; // Volume spike multiplier
  private readonly PRICE_CHANGE_THRESHOLD = 0.05; // 5% price change threshold
  private readonly PROFIT_TARGET = 0.15; // 15% profit target
  private readonly STOP_LOSS = 0.07; // 7% stop loss
  private readonly MAX_HOLD_TIME = 300; // 5 minutes max hold time
  private readonly MIN_VOLUME_USD = 1000; // Minimum volume in USD
  private readonly FIXED_TOKEN_AMOUNT = 1000; // Always buy 1000 tokens

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
    private readonly priceDataWindow: number = 300 // 5 minutes of price data
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
    if (this.currentPosition) {
      if (this.shouldSell(currentData)) {
        this.executeSell(currentData);
      }
    } else if (this.shouldBuy(currentData)) {
      this.executeBuy(currentData);
    }
  }

  private shouldBuy(currentData: MarketData): boolean {
    if (this.marketData.length < 2) return false;

    // Check if we have enough USD for the fixed token amount
    const requiredUsd = this.FIXED_TOKEN_AMOUNT * currentData.price;
    if (this.wallet.usd < requiredUsd) {
      console.log(
        `Insufficient USD balance for fixed token amount. Required: $${requiredUsd.toFixed(2)}, Available: $${this.wallet.usd.toFixed(2)}`
      );
      return false;
    }

    // Calculate key metrics
    const volumeSpike = this.detectVolumeSpikePattern(currentData);
    const priceMovement = this.detectPriceMovement(currentData);
    const buyPressure = this.calculateBuyPressure();
    const momentum = this.calculateMomentum();

    // Buy conditions:
    // 1. Volume spike detected
    // 2. Significant positive price movement (> PRICE_CHANGE_THRESHOLD)
    // 3. Strong buy pressure
    // 4. Positive momentum
    return (
      volumeSpike &&
      priceMovement >= this.PRICE_CHANGE_THRESHOLD && // Added threshold check
      buyPressure > 0.6 &&
      momentum > 0 &&
      currentData.volume1m >= this.MIN_VOLUME_USD
    );
  }

  private shouldSell(currentData: MarketData): boolean {
    if (!this.currentPosition) return false;

    const profitLoss = (currentData.price - this.currentPosition.entryPrice) / this.currentPosition.entryPrice;
    const holdingTime = currentData.timestamp - this.currentPosition.timestamp;

    // Sell conditions:
    // 1. Profit target reached
    // 2. Stop loss hit
    // 3. Maximum holding time exceeded
    // 4. Reversal pattern detected
    return (
      profitLoss >= this.PROFIT_TARGET ||
      profitLoss <= -this.STOP_LOSS ||
      holdingTime >= this.MAX_HOLD_TIME ||
      this.detectReversalPattern(currentData)
    );
  }

  private detectVolumeSpikePattern(currentData: MarketData): boolean {
    const avgVolume = this.calculateAverageVolume();
    return currentData.volume1m > avgVolume * this.VOLUME_SPIKE_THRESHOLD;
  }

  private detectPriceMovement(currentData: MarketData): number {
    const recentPrices = this.marketData.slice(-3);
    if (recentPrices.length < 3) return 0;

    // Calculate percentage change
    const priceChange = (currentData.price - recentPrices[0].price) / recentPrices[0].price;

    // Log significant price movements
    if (Math.abs(priceChange) >= this.PRICE_CHANGE_THRESHOLD) {
      console.log(`Significant price movement detected: ${(priceChange * 100).toFixed(2)}%`);
    }

    return priceChange;
  }

  private calculateBuyPressure(): number {
    const recentTrades = this.marketData.slice(-10);
    const buyCount = recentTrades.filter((d) => d.tradeType === 'BUY').length;
    return buyCount / recentTrades.length;
  }

  private calculateMomentum(): number {
    const prices = this.marketData.map((d) => d.price);
    if (prices.length < 2) return 0;

    const momentum = prices[prices.length - 1] - prices[0];
    return momentum;
  }

  private detectReversalPattern(currentData: MarketData): boolean {
    if (this.marketData.length < 3) return false;

    const recentData = this.marketData.slice(-3);
    const priceChanges = recentData.map((d, i) =>
      i > 0 ? (d.price - recentData[i - 1].price) / recentData[i - 1].price : 0
    );

    // Detect potential reversal patterns
    const wasIncreasing = priceChanges[1] > this.PRICE_CHANGE_THRESHOLD; // Modified to use threshold
    const isDecreasing = priceChanges[2] < -this.PRICE_CHANGE_THRESHOLD; // Modified to use threshold
    const volumeDecreasing = currentData.volume1m < recentData[1].volume1m;

    // Log potential reversals
    if (wasIncreasing && isDecreasing) {
      console.log(
        `Potential reversal detected: Up ${(priceChanges[1] * 100).toFixed(2)}% -> Down ${(priceChanges[2] * 100).toFixed(2)}%`
      );
    }

    return wasIncreasing && isDecreasing && volumeDecreasing;
  }

  private calculateAverageVolume(): number {
    if (this.marketData.length === 0) return 0;
    const volumes = this.marketData.map((d) => d.volume1m);
    return volumes.reduce((a, b) => a + b, 0) / volumes.length;
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

    // Log the trade
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
    const profitLoss = ((currentData.price - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100;
    const holdTime = currentData.timestamp - this.currentPosition.timestamp;

    this.wallet.usd += saleAmount;
    this.wallet.tokens -= this.currentPosition.amount;

    // Log the trade with percentage gain/loss
    this.logTrade({
      timestamp: currentData.timestamp,
      type: 'SELL',
      price: currentData.price,
      amount: this.currentPosition.amount,
      total: saleAmount,
      profitLoss: profitLoss, // Now in percentage
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
      ${this.currentPosition ? `Current Position: ${this.currentPosition.amount} tokens @ $${this.currentPosition.entryPrice}` : 'No active position'}
    `;
  }

  public getTradingStats(): string {
    const trades = this.readTrades();
    if (trades.length === 0) return 'No trades yet';

    const profits = trades.filter((t) => t.type === 'SELL' && t.profitLoss !== undefined).map((t) => t.profitLoss!);

    const totalTrades = trades.length;
    const profitableTrades = profits.filter((p) => p > 0).length;
    const averageProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
    const maxProfit = Math.max(...profits, 0);
    const maxLoss = Math.min(...profits, 0);

    return `
      Trading Stats for ${this.tokenId}:
      Total Trades: ${totalTrades}
      Profitable Trades: ${profitableTrades}
      Win Rate: ${((profitableTrades / (trades.length / 2)) * 100).toFixed(2)}%
      Average Profit/Loss: ${averageProfit.toFixed(2)}%
      Max Profit: ${maxProfit.toFixed(2)}%
      Max Loss: ${maxLoss.toFixed(2)}%
      Current Balance: $${this.wallet.usd.toFixed(2)}
      Current Tokens: ${this.wallet.tokens}
    `;
  }
}
