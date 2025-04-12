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
  volume24h: number;
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
    console.log('Received transaction:', data);
    if (!data.transaction?.transaction) return;
    
    try {
      const instructions = data.transaction.transaction?.transaction?.message?.instructions || [];
      
      const txInfo: VersionedTransactionResponse = {
        blockTime: Math.floor(Date.now() / 1000),
        meta: null,
        slot: data.slot ? Number(data.slot) : 0,
        transaction: {
          message: {
            instructions: instructions.map(instruction => ({
              accounts: Array.from(instruction.accounts),
              data: base58.encode(Buffer.from(instruction.data)),
              programIdIndex: instruction.programIdIndex
            })),
            recentBlockhash: '',
            accountKeys: [DEX_PROGRAMS.PUMP_SWAP.id], // Add Pumpswap program ID
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

      // Force parser to recognize as Pumpswap
      const dexInfo = {
        programId: DEX_PROGRAMS.PUMP_SWAP.id,
        amm: DEX_PROGRAMS.PUMP_SWAP.name
      };

      const parser = new DexParser();
      const result = parser.parseAll(txInfo as unknown as SolanaTransaction, {
        programIds: [DEX_PROGRAMS.PUMP_SWAP.id], // Only parse Pumpswap
        tryUnknowDEX: false
      });
      const trades = result.trades;
      console.log('Parsed trades:', trades);
      
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
    for (const trade of trades) {
      // Only process trades involving our token
      if (trade.inputToken.mint !== this.tokenAddress && trade.outputToken.mint !== this.tokenAddress) {
        continue;
      }

      const timestamp = Math.floor(trade.timestamp / 1000) * 1000; // Round to nearest second
      const isSell = trade.inputToken.mint === this.tokenAddress;

      // Calculate price in SOL
      let price: number;
      if (isSell) {
        price = trade.outputToken.amount / trade.inputToken.amount;
      } else {
        price = trade.inputToken.amount / trade.outputToken.amount;
      }

      // Update metrics
      const currentMetrics = this.metrics.get(timestamp) || {
        price,
        marketCap: 0, // Need total supply for this
        volume24h: 0,
        timestamp,
      };

      // Update volume
      const volume = isSell ? trade.inputToken.amount : trade.outputToken.amount;
      currentMetrics.volume24h += volume;

      // Update price as weighted average
      currentMetrics.price = (currentMetrics.price + price) / 2;

      this.metrics.set(timestamp, currentMetrics);
      this.printMetrics(currentMetrics);
    }
  }

  private printMetrics(metrics: TokenMetrics) {
    console.log(`
      Timestamp: ${new Date(metrics.timestamp).toISOString()}
      Price (SOL): ${metrics.price.toFixed(6)}
      24h Volume: ${metrics.volume24h.toFixed(2)}
      Market Cap: ${metrics.marketCap.toFixed(2)}
    `);
  }
}

