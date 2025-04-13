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

export class TradingBot {
  private readonly VOLUME_SPIKE_THRESHOLD = 2.0; // Volume spike multiplier
  private readonly PRICE_CHANGE_THRESHOLD = 0.05; // 5% price change threshold
  private readonly PROFIT_TARGET = 0.15; // 15% profit target
  private readonly STOP_LOSS = 0.07; // 7% stop loss
  private readonly MAX_HOLD_TIME = 300; // 5 minutes max hold time
  private readonly MIN_VOLUME_USD = 1000; // Minimum volume in USD

  private marketData: MarketData[] = [];
  private currentPosition: TradingPosition | null = null;
  private wallet = {
    usd: 10000, // Starting with $10,000
    tokens: 0,
  };

  constructor(
    private readonly maxPositionSize: number = 1000, // Maximum position size in USD
    private readonly priceDataWindow: number = 300 // 5 minutes of price data
  ) {}

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

    // Calculate key metrics
    const volumeSpike = this.detectVolumeSpikePattern(currentData);
    const priceMovement = this.detectPriceMovement(currentData);
    const buyPressure = this.calculateBuyPressure();
    const momentum = this.calculateMomentum();

    // Buy conditions:
    // 1. Volume spike detected
    // 2. Positive price movement
    // 3. Strong buy pressure
    // 4. Positive momentum
    return (
      volumeSpike &&
      priceMovement > 0 &&
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

    return (currentData.price - recentPrices[0].price) / recentPrices[0].price;
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
    const wasIncreasing = priceChanges[1] > 0;
    const isDecreasing = priceChanges[2] < 0;
    const volumeDecreasing = currentData.volume1m < recentData[1].volume1m;

    return wasIncreasing && isDecreasing && volumeDecreasing;
  }

  private calculateAverageVolume(): number {
    if (this.marketData.length === 0) return 0;
    const volumes = this.marketData.map((d) => d.volume1m);
    return volumes.reduce((a, b) => a + b, 0) / volumes.length;
  }

  private executeBuy(currentData: MarketData): void {
    const positionSize = Math.min(this.maxPositionSize, this.wallet.usd);
    const tokenAmount = positionSize / currentData.price;

    this.currentPosition = {
      entryPrice: currentData.price,
      amount: tokenAmount,
      timestamp: currentData.timestamp,
    };

    this.wallet.usd -= positionSize;
    this.wallet.tokens += tokenAmount;

    console.log(`
      BUY EXECUTED
      Price: $${currentData.price}
      Amount: ${tokenAmount} tokens
      Total: $${positionSize}
      Timestamp: ${new Date(currentData.timestamp * 1000).toISOString()}
    `);
  }

  private executeSell(currentData: MarketData): void {
    if (!this.currentPosition) return;

    const saleAmount = this.currentPosition.amount * currentData.price;
    const profitLoss = ((currentData.price - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100;

    this.wallet.usd += saleAmount;
    this.wallet.tokens -= this.currentPosition.amount;

    console.log(`
      SELL EXECUTED
      Entry Price: $${this.currentPosition.entryPrice}
      Exit Price: $${currentData.price}
      Amount: ${this.currentPosition.amount} tokens
      Total: $${saleAmount}
      Profit/Loss: ${profitLoss.toFixed(2)}%
      Hold Time: ${currentData.timestamp - this.currentPosition.timestamp}s
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
}
