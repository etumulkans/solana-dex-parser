/* eslint-disable max-len */
/* eslint-disable prettier/prettier */
import Client, { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { ClientDuplexStream } from '@grpc/grpc-js';
import { DexParser } from '../dex-parser';
import { TradeInfo } from '../types';
import { VersionedMessage, VersionedTransactionResponse } from '@solana/web3.js';
import base58 from 'bs58';
import { DEX_PROGRAMS } from '../constants';
import { TradingBot } from '../trading/trading-bot';

interface TokenMetrics {
  price: number;
  marketCap: number;
  volume1m: number;
  volume5m: number;
  volume1h: number;
  timestamp: number;
}

interface MarketData {
  timestamp: number;
  price: number;
  volume1m: number;
  volume5m: number;
  marketCap: number;
  tradeAmount: number;
  tradeType: 'BUY' | 'SELL';
}

export class TokenScanner {
  private client: Client;
  private parser: DexParser;
  private tokenAddress: string;
  private metrics: Map<number, TokenMetrics>;
  private volumeWindows: {
    oneMin: { timestamp: number; volume: number; }[];
    fiveMin: { timestamp: number; volume: number; }[];
    oneHour: { timestamp: number; volume: number; }[];
  };
  private readonly ENDPOINT = 'http://grpc.solanavibestation.com:10000';
  private stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate> | null = null;
  private tradingBot: TradingBot;

  constructor(tokenAddress: string) {
    this.tokenAddress = tokenAddress;
    this.parser = new DexParser();
    this.metrics = new Map();
    this.client = new Client(this.ENDPOINT, undefined, {});
    this.volumeWindows = {
      oneMin: [],
      fiveMin: [],
      oneHour: []
    };
    this.tradingBot = new TradingBot(tokenAddress);
  }

  private createSubscribeRequest(): SubscribeRequest {
    return {
      accounts: {},
      slots: {},
      transactions: {
        tokenAccount: {
          accountInclude: [this.tokenAddress],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: { },
      commitment: CommitmentLevel.PROCESSED,
      accountsDataSlice: [],
      ping: undefined,
    };
  }

  private async reconnectStream(): Promise<ClientDuplexStream<SubscribeRequest, SubscribeUpdate>> {
    try {
      const stream = await this.client.subscribe();
      const request = this.createSubscribeRequest();
      console.log('Creating new gRPC stream connection...');
      await this.sendSubscribeRequest(stream, request);
      console.log('Sending subscribe request...');
      console.log('Successfully created new gRPC stream connection');
      return stream;
    } catch (error) {
      console.error('Error creating new stream:', error);
      throw error;
    }
  }

  private sendSubscribeRequest(
    stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>,
    request: SubscribeRequest
  ): Promise<void> {
    console.log('Sending subscribe request...');
    return new Promise<void>((resolve, reject) => {
      stream.write(request, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async handleStreamEvents(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>): Promise<void> {
    console.log('Starting to handle stream events...');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new Promise<void>((resolve, reject) => {
      stream.on('data', async (data) => {
        try {
          await this.handleData(data);
        } catch (error) {
          console.error('Error processing data:', error);
          if (error instanceof Error && error.message.includes('decode')) {
            console.log('Recoverable decoding error - continuing...');
            return;
          }
        }
      });

      stream.on('error', async (error: Error) => {
        console.error('Stream error:', error);
        stream.end();

        console.log('Attempting to reconnect in 5 seconds...');
        setTimeout(async () => {
          try {
            const newStream = await this.reconnectStream();
            this.stream = newStream;
            await this.handleStreamEvents(newStream);
          } catch (reconnectError) {
            console.error('Reconnection failed:', reconnectError);
            setTimeout(() => this.handleStreamEvents(stream), 5000);
          }
        }, 5000);
      });

      stream.on('end', () => {
        console.log('Stream ended - attempting to reconnect...');
        setTimeout(() => this.handleStreamEvents(stream), 5000);
      });
    });
  }

  private async handleData(data: SubscribeUpdate): Promise<void> {
    

    if (!data.transaction?.transaction) return;
    
   
    try {
      
      const instructions = data.transaction.transaction?.transaction?.message?.instructions || [];
      // Get raw keys and properly encode them to base58
      const rawKeys = data.transaction?.transaction?.transaction?.message?.accountKeys || [];
      const accountKeys = rawKeys.map(key => {
        if (Buffer.isBuffer(key)) {
          return base58.encode(key);
        }
        // Fallback for any other type
        return key.toString();
      });
      const txInfo: VersionedTransactionResponse = {
        blockTime: Math.floor(Date.now() / 1000),
        meta: {
          err: data.transaction.transaction.meta?.err || null,
          fee: Number(data.transaction.transaction.meta?.fee) || 0,
          postBalances: (data.transaction.transaction.meta?.postBalances || []).map(Number),
          preBalances: (data.transaction.transaction.meta?.preBalances || []).map(Number),
          innerInstructions: (data.transaction.transaction.meta?.innerInstructions || []).map(inner => ({
            index: inner.index,
            instructions: inner.instructions.map(ix => ({
              programIdIndex: ix.programIdIndex,
              accounts: Array.from(ix.accounts),
              data: base58.encode(Buffer.from(ix.data))
            }))
          })),
          logMessages: data.transaction.transaction.meta?.logMessages || [],
          postTokenBalances: (data.transaction.transaction.meta?.postTokenBalances || []).map(balance => ({
            accountIndex: balance.accountIndex,
            mint: balance.mint,
            owner: balance.owner,
            uiTokenAmount: balance.uiTokenAmount || {
              amount: "0",
              decimals: 0,
              uiAmount: 0,
              uiAmountString: "0"
            }
          })),
          preTokenBalances: (data.transaction.transaction.meta?.preTokenBalances || []).map(balance => ({
            accountIndex: balance.accountIndex,
            mint: balance.mint,
            owner: balance.owner,
            uiTokenAmount: balance.uiTokenAmount || {
              amount: "0",
              decimals: 0,
              uiAmount: 0,
              uiAmountString: "0"
            }
          })),
        },
        slot: data.slot ? Number(data.slot) : 0,
        transaction: {
          message: {
            instructions: instructions.map(instruction => ({
              accounts: Array.from(instruction.accounts),
              data: base58.encode(Buffer.from(instruction.data)),
              programIdIndex: instruction.programIdIndex
            })),
            recentBlockhash: '',
            accountKeys: accountKeys,
            header: {
              numReadonlySignedAccounts: 0,
              numReadonlyUnsignedAccounts: 0,
              numRequiredSignatures: 0
            }
          } as unknown as VersionedMessage,
          signatures: [
            base58.encode(Buffer.from(data.transaction.transaction.signature || ''))
          ]
        },
        version: 'legacy'
      }; 

      // Force Pumpswap parsing
      const parser = new DexParser();
      // const trades = parser.parseTrades(txInfo as any, {
      //   programIds: [DEX_PROGRAMS.PUMP_SWAP.id],
      //   tryUnknowDEX: false
      // });
      //console.log("trades:", txInfo);

      const trades = parser.parseTrades(txInfo as any, {
        tryUnknowDEX: true
      });

      

      if (trades.length > 0) {
        
        this.processTrades(trades);
      }
    } catch (error) {
      console.error('Error processing transaction:', error);
    }
  }

  public async startScanning(): Promise<void> {
    this.stream = await this.reconnectStream();
    await this.handleStreamEvents(this.stream);
    // while (true) {
    //   try {
    //     console.log
    //     this.stream = await this.reconnectStream();
    //     await this.handleStreamEvents(this.stream);
    //   } catch (error) {
    //     console.error('Main loop error:', error);
    //     console.log('Retrying in 5 seconds...');
    //     await new Promise((resolve) => setTimeout(resolve, 5000));
    //   }
    // }
  }

  public async stopScanning(): Promise<void> {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  private processTrades(trades: TradeInfo[]) {
    const SOL_PRICE_USD = 130;
    const TOTAL_SUPPLY = 1_000_000_000;
    const now = Math.floor(Date.now() / 1000);

    if (!trades.length || (trades[0].type !== 'BUY' && trades[0].type !== 'SELL')) {
      return;
    }
    //console.log('Found trades:', trades);

    for (const trade of trades) {
      if (trade.inputToken.mint !== this.tokenAddress && trade.outputToken.mint !== this.tokenAddress) {
        continue;
      }
      console.log(trades);
      const timestamp = trade.timestamp;
      const isSell = trade.inputToken.mint === this.tokenAddress;

      // Get token amount regardless of buy or sell
      const tokenAmount = isSell ? 
        Number(trade.inputToken.amountRaw) / Math.pow(10, trade.inputToken.decimals) :
        Number(trade.outputToken.amountRaw) / Math.pow(10, trade.outputToken.decimals);

      // Calculate USD price
      const solAmount = isSell ?
        Number(trade.outputToken.amountRaw) / Math.pow(10, 9) :
        Number(trade.inputToken.amountRaw) / Math.pow(10, 9);

      console.log("type:", trade.type, "tokenAmount:", tokenAmount, "solAmount:", solAmount);
      
      const solPrice =  solAmount / tokenAmount;
      let usdPrice = solPrice * SOL_PRICE_USD;

      if (usdPrice < 0.00000001) {
        usdPrice = Number(usdPrice.toExponential(8));
      }

      const marketCap = usdPrice * TOTAL_SUPPLY;
      const volumeUSD = tokenAmount * usdPrice;

      // Clean up old volume entries
      this.cleanupOldVolumes(now);

      // Add new volume entry
      this.volumeWindows.oneMin.push({ timestamp, volume: volumeUSD });
      this.volumeWindows.fiveMin.push({ timestamp, volume: volumeUSD });
      this.volumeWindows.oneHour.push({ timestamp, volume: volumeUSD });

      // Calculate cumulative volumes
      const volume1m = this.calculateWindowVolume(this.volumeWindows.oneMin, now, 60);
      const volume5m = this.calculateWindowVolume(this.volumeWindows.fiveMin, now, 300);
      const volume1h = this.calculateWindowVolume(this.volumeWindows.oneHour, now, 3600);

      // Update metrics
      const currentMetrics: TokenMetrics = {
        price: usdPrice,
        marketCap: marketCap,
        volume1m: volume1m,
        volume5m: volume5m,
        volume1h: volume1h,
        timestamp: timestamp
      };

      this.metrics.set(timestamp, currentMetrics);
      this.printMetrics(currentMetrics);

      const marketData: MarketData = {
        timestamp: timestamp,
        price: usdPrice,
        volume1m: volume1m,
        volume5m: volume5m,
        marketCap: marketCap,
        tradeAmount: tokenAmount,
        tradeType: trade.type
      };

      this.tradingBot.updateMarketData(marketData);
    }
  }

  private cleanupOldVolumes(now: number) {
    // Remove entries older than the window
    this.volumeWindows.oneMin = this.volumeWindows.oneMin.filter(
      entry => now - entry.timestamp <= 60
    );
    this.volumeWindows.fiveMin = this.volumeWindows.fiveMin.filter(
      entry => now - entry.timestamp <= 300
    );
    this.volumeWindows.oneHour = this.volumeWindows.oneHour.filter(
      entry => now - entry.timestamp <= 3600
    );
  }

  private calculateWindowVolume(entries: { timestamp: number; volume: number; }[], now: number, windowSize: number): number {
    return entries
      .filter(entry => now - entry.timestamp <= windowSize)
      .reduce((sum, entry) => sum + entry.volume, 0);
  }

  private formatVolume(volume: number): string {
    if (volume >= 1000) {
      return `$${(volume / 1000).toFixed(2)}K`;
    }
    return `$${volume.toFixed(2)}`;
  }

  private printMetrics(metrics: TokenMetrics) {
    const formattedPrice = metrics.price < 0.00000001 ? 
      metrics.price.toExponential(8) : 
      metrics.price.toFixed(9);

    const formatMarketCap = (marketCap: number): string => {
      if (marketCap >= 1_000_000_000) {
        return `$${(marketCap / 1_000_000_000).toFixed(2)}B`;
      } else if (marketCap >= 1_000_000) {
        return `$${(marketCap / 1_000_000).toFixed(2)}M`;
      } else if (marketCap >= 1_000) {
        return `$${(marketCap / 1_000).toFixed(2)}K`;
      }
      return `$${marketCap.toFixed(2)}`;
    };

    // console.log(`
    //   Timestamp: ${new Date(metrics.timestamp).toISOString()}
    //   Price (USD): $${formattedPrice}
    //   Volume 1m:  ${this.formatVolume(metrics.volume1m)}
    //   Volume 5m:  ${this.formatVolume(metrics.volume5m)}
    //   Volume 1h:  ${this.formatVolume(metrics.volume1h)}
    //   Market Cap: ${formatMarketCap(metrics.marketCap)}
    // `);
  }
}

