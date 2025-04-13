/* eslint-disable max-len */
/* eslint-disable prettier/prettier */
import Client, { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { ClientDuplexStream } from '@grpc/grpc-js';
import { DexParser } from '../dex-parser';
import { TradeInfo } from '../types';
import { VersionedMessage, VersionedTransactionResponse } from '@solana/web3.js';
import base58 from 'bs58';
import { DEX_PROGRAMS } from '../constants';

interface TokenMetrics {
  price: number;
  marketCap: number;
  volume1m: number;
  volume5m: number;
  volume1h: number;
  timestamp: number;
}

export class TokenScanner {
  private client: Client;
  private parser: DexParser;
  private tokenAddress: string;
  private metrics: Map<number, TokenMetrics>;
  private readonly ENDPOINT = 'http://grpc.solanavibestation.com:10000';
  private stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate> | null = null;

  constructor(tokenAddress: string) {
    this.tokenAddress = tokenAddress;
    this.parser = new DexParser();
    this.metrics = new Map();
    this.client = new Client(this.ENDPOINT, undefined, {});
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
      const trades = parser.parseTrades(txInfo as any, {
        programIds: [DEX_PROGRAMS.PUMP_SWAP.id],
        tryUnknowDEX: false
      });
      
      if (trades.length > 0) {
        console.log('Found trades:', trades);
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
    const now = Math.floor(Date.now() / 1000); // Convert to seconds

    for (const trade of trades) {
      if (trade.inputToken.mint !== this.tokenAddress && trade.outputToken.mint !== this.tokenAddress) {
        continue;
      }

      const timestamp = Math.floor(trade.timestamp / 1000) * 1000;
      const isSell = trade.inputToken.mint === this.tokenAddress;

      // Get token amount regardless of buy or sell
      const tokenAmount = isSell ? 
        Number(trade.inputToken.amountRaw) / Math.pow(10, trade.inputToken.decimals) :
        Number(trade.outputToken.amountRaw) / Math.pow(10, trade.outputToken.decimals);

      // Calculate USD price
      const solAmount = isSell ?
        Number(trade.outputToken.amountRaw) / Math.pow(10, 9) :
        Number(trade.inputToken.amountRaw) / Math.pow(10, 9);

      const solPrice = isSell ? solAmount / tokenAmount : solAmount / tokenAmount;
      let usdPrice = solPrice * SOL_PRICE_USD;

      if (usdPrice < 0.00000001) {
        usdPrice = Number(usdPrice.toExponential(8));
      }

      const marketCap = usdPrice * TOTAL_SUPPLY;

      // Calculate volume in USD (token amount * price)
      const volumeUSD = tokenAmount * usdPrice;

      // Update metrics
      const currentMetrics = this.metrics.get(timestamp) || {
        price: usdPrice,
        marketCap: marketCap,
        volume1m: 0,
        volume5m: 0,
        volume1h: 0,
        timestamp,
      };

      // Update volumes based on time windows
      const timeDiff = now - timestamp;
      if (timeDiff <= 60 * 1000) { // 1 minute
        currentMetrics.volume1m += volumeUSD;
      }
      if (timeDiff <= 5 * 60 * 1000) { // 5 minutes
        currentMetrics.volume5m += volumeUSD;
      }
      if (timeDiff <= 60 * 60 * 1000) { // 1 hour
        currentMetrics.volume1h += volumeUSD;
      }

      currentMetrics.price = usdPrice;
      currentMetrics.marketCap = marketCap;

      this.metrics.set(timestamp, currentMetrics);
      this.printMetrics(currentMetrics);
    }
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

    console.log(`
      Timestamp: ${new Date(metrics.timestamp).toISOString()}
      Price (USD): $${formattedPrice}
      Volume 1m:  ${this.formatVolume(metrics.volume1m)}
      Volume 5m:  ${this.formatVolume(metrics.volume5m)}
      Volume 1h:  ${this.formatVolume(metrics.volume1h)}
      Market Cap: ${formatMarketCap(metrics.marketCap)}
    `);
  }
}

