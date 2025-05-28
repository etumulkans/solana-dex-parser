/* eslint-disable max-len */
/* eslint-disable prettier/prettier */
import Client, { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { ClientDuplexStream } from '@grpc/grpc-js';
import { DexParser  } from '../dex-parser';
import { TradeInfo , PoolEvent } from '../types';
import { VersionedMessage, VersionedTransactionResponse } from '@solana/web3.js';
import base58 from 'bs58';
import { DEX_PROGRAMS } from '../constants';
import { TradingBot } from '../trading/trading-bot';



export class TokenScanner {
  private client: Client;
  private parser: DexParser;
  private tokenAddress: string;
  private scanAddress:string;

  private volumeWindows: {
    oneMin: { timestamp: number; volume: number; }[];
    fiveMin: { timestamp: number; volume: number; }[];
    oneHour: { timestamp: number; volume: number; }[];
  };
  private readonly ENDPOINT = 'http://grpc.solanavibestation.com:10000';
  private stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate> | null = null;
  private tradingBot: TradingBot;

  constructor(tokenAddress: string,scanAddress: string) {
    this.tokenAddress = tokenAddress;
    this.scanAddress = scanAddress;
    this.parser = new DexParser();
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
          accountInclude: [this.scanAddress],
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
      //const sig = data.transaction.transaction.signature;
      //console.log(sig);
      const instructions = data.transaction.transaction?.transaction?.message?.instructions || [];

      const hasCreateAccountWithSeed = instructions.length > 0 && instructions[0].data && Buffer.from(instructions[0].data)[0] === 3;
      
      if (hasCreateAccountWithSeed) {
       // console.log('Found createAccountWithSeed transaction');
        // Handle the createAccountWithSeed transaction here
        return;
      }

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
      const liquidity = parser.parseLiquidity(txInfo as any, {
        tryUnknowDEX: true
      });
      

      if (trades.length > 0) {
        
        this.processTrades(trades,liquidity);
      }
    } catch (error) {
      console.error('Error processing transaction:', error);
    }
  }

  public async startScanning(): Promise<void> {
    this.stream = await this.reconnectStream();
    await this.handleStreamEvents(this.stream);
  }

  public async stopScanning(): Promise<void> {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  private processTrades(trades: TradeInfo[],liquidity: PoolEvent[]) {
    const SOL_PRICE_USD = 170;
    const TOTAL_SUPPLY = 1_000_000_000;
    const now = Math.floor(Date.now() / 1000);
    const sig = trades[0].signature;
    if (liquidity.length > 0) {
      console.log('Found liquidity events:', liquidity);
    }
    //console.log('Trade timestamp:', trades[0].timestamp, 'Current timestamp:', now, 'Difference (s):', now - trades[0].timestamp);
    return;
    

   
    
  }

}

