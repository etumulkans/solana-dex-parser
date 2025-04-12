/* eslint-disable prettier/prettier */
import Client, { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { ClientDuplexStream } from '@grpc/grpc-js';
import { DexParser } from '../dex-parser';
import { TradeInfo } from '../types';

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
      blocksMeta: { blockmetadata: {} },
      commitment: CommitmentLevel.PROCESSED,
      accountsDataSlice: [],
      ping: undefined,
    };
  }

  private async reconnectStream(): Promise<ClientDuplexStream<SubscribeRequest, SubscribeUpdate>> {
    try {
      const stream = await this.client.subscribe();
      const request = this.createSubscribeRequest();
      await this.sendSubscribeRequest(stream, request);
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
    return new Promise<void>((_, reject) => {
      stream.write(request, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve(); // Resolve the promise when the write operation succeeds
        }
      });
    });
  }

  private async handleStreamEvents(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>): Promise<void> {
    console.log('Starting to handle stream events...');
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
      // Convert the gRPC transaction format to Solana web3.js format
      const txData: {
        slot: number;
        blockTime: number;
        transaction: {
          message: {
            header: {
              numRequiredSignatures: number;
              numReadonlySignedAccounts: number;
              numReadonlyUnsignedAccounts: number;
            };
            accountKeys: string[];
            recentBlockhash: string;
            instructions: any[];
            indexToProgramIds: any[];
            version: string;
            staticAccountKeys: string[];
            compiledInstructions: any[];
          };
          signatures: string[];
        };
        meta: {
          fee: number;
          logMessages: string[];
          postBalances: number[];
          preBalances: number[];
          status: { Ok: null } | null;
        } | null;
      } = {
        slot: data.slot ? Number(data.slot) : 0,
        blockTime: Math.floor(Date.now() / 1000), // Current timestamp as fallback
        transaction: {
          message: {
            header: {
              numRequiredSignatures: 0,
              numReadonlySignedAccounts: 0,
              numReadonlyUnsignedAccounts: 0,
            },
            accountKeys: [],
            recentBlockhash: '',
            instructions: [],
            indexToProgramIds: [],
            version: 'legacy',
            staticAccountKeys: [],
            compiledInstructions: [],
          },
          signatures: [
            Buffer.from(data.transaction.transaction.signature || '').toString('base64')
          ]
        },
        meta: data.transaction.transaction.meta 
          ? {
              ...data.transaction.transaction.meta,
              fee: Number(data.transaction.transaction.meta.fee),
              logMessages: data.transaction.transaction.meta.logMessages || [],
              postBalances: (data.transaction.transaction.meta.postBalances || []).map(Number),
              preBalances: (data.transaction.transaction.meta.preBalances || []).map(Number),
              status: { Ok: null } // Assuming successful transaction
            }
          : null
      };

      // Assuming SolanaTransaction is a placeholder, replace it with the correct type or define it
      const trades = this.parser.parseTrades(txData as unknown as any); // Replace 'any' with the correct type if known
      
      if (trades.length > 0) {
        this.processTrades(trades);
      }
    } catch (error) {
      console.error('Error processing transaction:', error);
    }
  }

  public async startScanning(): Promise<void> {
    while (true) {
      try {
        console.log('Starting main loop...');
        this.stream = await this.reconnectStream();
        await this.handleStreamEvents(this.stream);
      } catch (error) {
        console.error('Main loop error:', error);
        console.log('Retrying in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
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
function resolve(): void {
  // This function is used to resolve the promise in sendSubscribeRequest.
  // Since the promise is resolved when the write operation succeeds,
  // this function can remain empty as it serves as a placeholder for resolution.
}
 