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
    for (const trade of trades) {
      // Only process trades involving our token
      if (trade.inputToken.mint !== this.tokenAddress && trade.outputToken.mint !== this.tokenAddress) {
        continue;
      }

      const timestamp = Math.floor(trade.timestamp / 1000) * 1000;
      const isSell = trade.inputToken.mint === this.tokenAddress;

      // Get raw amounts
      const tokenRawAmount = isSell ? trade.inputToken.amountRaw : trade.outputToken.amountRaw;
      const solRawAmount = isSell ? trade.outputToken.amountRaw : trade.inputToken.amountRaw;

      // Convert to numbers, handling scientific notation
      const tokenAmount = Number(tokenRawAmount) / Math.pow(10, isSell ? trade.inputToken.decimals : trade.outputToken.decimals);
      const solAmount = Number(solRawAmount) / Math.pow(10, 9); // SOL decimals

      // Calculate price - for small numbers, we need to handle precision carefully
      let price: number;
      if (isSell) {
        price = solAmount / tokenAmount;
      } else {
        price = solAmount / tokenAmount;
      }

      // Ensure price is in the correct range (handling very small numbers)
      if (price < 0.00000001) {
        price = Number(price.toExponential(8));
      }

      // Update metrics
      const currentMetrics = this.metrics.get(timestamp) || {
        price,
        marketCap: 0,
        volume24h: 0,
        timestamp,
      };

      // Update volume using the token amount
      currentMetrics.volume24h += tokenAmount;
      currentMetrics.price = price;

      this.metrics.set(timestamp, currentMetrics);
      this.printMetrics(currentMetrics);
    }
  }

  private printMetrics(metrics: TokenMetrics) {
    // Format price with scientific notation for very small numbers
    const formattedPrice = metrics.price < 0.00000001 ? 
      metrics.price.toExponential(8) : 
      metrics.price.toFixed(9);

    console.log(`
      Timestamp: ${new Date(metrics.timestamp).toISOString()}
      Price (SOL): ${formattedPrice}
      24h Volume: ${metrics.volume24h.toFixed(6)}
      Market Cap: ${metrics.marketCap > 0 ? metrics.marketCap.toFixed(2) : 'N/A'}
    `);
  }
}

