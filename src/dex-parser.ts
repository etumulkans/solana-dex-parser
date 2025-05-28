import { DEX_PROGRAM_IDS, DEX_PROGRAMS } from './constants';
import { InstructionClassifier } from './instruction-classifier';
import {
  JupiterParser,
  MeteoraDLMMPoolParser,
  MeteoraParser,
  MeteoraPoolsParser,
  MoonshotParser,
  OrcaLiquidityParser,
  OrcaParser,
  PumpfunParser,
  PumpswapLiquidityParser,
  PumpswapParser,
  RaydiumCLPoolParser,
  RaydiumCPMMPoolParser,
  RaydiumParser,
  RaydiumV4PoolParser,
} from './parsers';
import { TransactionAdapter } from './transaction-adapter';
import { TransactionUtils } from './transaction-utils';
import {
  ClassifiedInstruction,
  DexInfo,
  ParseConfig,
  ParseResult,
  PoolEvent,
  SolanaTransaction,
  TradeInfo,
  TransferData,
} from './types';
import { getProgramName } from './utils';

/**
 * Interface for DEX trade parsers
 */
type ParserConstructor = new (
  adapter: TransactionAdapter,
  dexInfo: DexInfo,
  transferActions: Record<string, TransferData[]>,
  classifiedInstructions: ClassifiedInstruction[]
) => {
  processTrades(): TradeInfo[];
};

/**
 * Interface for liquidity pool parsers
 */
type ParserLiquidityConstructor = new (
  adapter: TransactionAdapter,
  transferActions: Record<string, TransferData[]>,
  classifiedInstructions: ClassifiedInstruction[]
) => {
  processLiquidity(): PoolEvent[];
};

/**
 * Main parser class for Solana DEX transactions
 */
export class DexParser {
  // Trade parser mapping
  private readonly parserMap: Record<string, ParserConstructor> = {
    [DEX_PROGRAMS.JUPITER.id]: JupiterParser,
    [DEX_PROGRAMS.JUPITER_DCA.id]: JupiterParser,
    [DEX_PROGRAMS.MOONSHOT.id]: MoonshotParser,
    [DEX_PROGRAMS.METEORA.id]: MeteoraParser,
    [DEX_PROGRAMS.METEORA_POOLS.id]: MeteoraParser,
    [DEX_PROGRAMS.PUMP_FUN.id]: PumpfunParser,
    [DEX_PROGRAMS.PUMP_SWAP.id]: PumpswapParser,
    [DEX_PROGRAMS.RAYDIUM_ROUTE.id]: RaydiumParser,
    [DEX_PROGRAMS.RAYDIUM_CL.id]: RaydiumParser,
    [DEX_PROGRAMS.RAYDIUM_CPMM.id]: RaydiumParser,
    [DEX_PROGRAMS.RAYDIUM_V4.id]: RaydiumParser,
    [DEX_PROGRAMS.ORCA.id]: OrcaParser,
  };

  // Liquidity parser mapping
  private readonly parseLiquidityMap: Record<string, ParserLiquidityConstructor> = {
    [DEX_PROGRAMS.METEORA.id]: MeteoraDLMMPoolParser,
    [DEX_PROGRAMS.METEORA_POOLS.id]: MeteoraPoolsParser,
    [DEX_PROGRAMS.RAYDIUM_V4.id]: RaydiumV4PoolParser,
    [DEX_PROGRAMS.RAYDIUM_CPMM.id]: RaydiumCPMMPoolParser,
    [DEX_PROGRAMS.RAYDIUM_CL.id]: RaydiumCLPoolParser,
    [DEX_PROGRAMS.ORCA.id]: OrcaLiquidityParser,
    [DEX_PROGRAMS.PUMP_FUN.id]: PumpswapLiquidityParser,
    [DEX_PROGRAMS.PUMP_SWAP.id]: PumpswapLiquidityParser,
  };

  constructor() {}

  /**
   * Parse transaction with specific type
   */
  private parseWithClassifier(
    tx: SolanaTransaction,
    config: ParseConfig = { tryUnknowDEX: true },
    parseType: 'trades' | 'liquidity' | 'transfer' | 'all'
  ): ParseResult {
    const result: ParseResult = {
      state: true,
      trades: [],
      liquidities: [],
      transfers: [],
    };

    try {
      const adapter = new TransactionAdapter(tx, config);
      //console.log('Parsing transaction:', tx?.transaction?.signatures?.[0]);
      const utils = new TransactionUtils(adapter);
      const classifier = new InstructionClassifier(adapter);
      // Get DEX information and validate
      const dexInfo = utils.getDexInfo(classifier);
      const allProgramIds = classifier.getAllProgramIds();
      const transferActions = utils.getTransferActions(['mintTo', 'burn', 'mintToChecked', 'burnChecked']);
      // Try specific parser first
      if (dexInfo.programId && [DEX_PROGRAMS.JUPITER.id, DEX_PROGRAMS.JUPITER_DCA.id].includes(dexInfo.programId)) {
        if (parseType === 'trades' || parseType === 'all') {
          const jupiterInstructions = classifier.getInstructions(dexInfo.programId);
          const parser = new JupiterParser(adapter, dexInfo, transferActions, jupiterInstructions);
          result.trades.push(...parser.processTrades());
        }
        return result;
      }

      // Process instructions for each program
      for (const programId of allProgramIds) {
        const classifiedInstructions = classifier.getInstructions(programId);

        // Process trades if needed
        if (parseType === 'trades' || parseType === 'all') {
          if (config?.programIds && !config.programIds.some((id) => id == programId)) continue;
          if (config?.ignoreProgramIds && config.ignoreProgramIds.some((id) => id == programId)) continue;

          const TradeParserClass = this.parserMap[programId];
          if (TradeParserClass) {
            const parser = new TradeParserClass(
              adapter,
              { ...dexInfo, programId: programId, amm: getProgramName(programId) },
              transferActions,
              classifiedInstructions
            );
            result.trades.push(...parser.processTrades());
          } else if (config?.tryUnknowDEX) {
            // Handle unknown DEX programs
            const transfers = Object.entries(transferActions).find(([key]) => key.startsWith(programId))?.[1];
            if (transfers && transfers.length >= 2) {
              const trade = utils.processSwapData(transfers, {
                ...dexInfo,
                programId: programId,
                amm: getProgramName(programId),
              });
              if (trade) result.trades.push(trade);
            }
          }
        }

        // Process liquidity if needed
        if (parseType === 'liquidity' || parseType === 'all') {
          if (config?.programIds && !config.programIds.some((id) => id == programId)) continue;
          if (config?.ignoreProgramIds && config.ignoreProgramIds.some((id) => id == programId)) continue;
          const LiquidityParserClass = this.parseLiquidityMap[programId];
          if (LiquidityParserClass) {
            const parser = new LiquidityParserClass(adapter, transferActions, classifiedInstructions);
            result.liquidities.push(...parser.processLiquidity());
          }
        }
      }
      // Deduplicate trades
      if (result.trades.length > 0) {
        console.log('Found liquidity events:', result.trades);
        result.trades = [...new Map(result.trades.map((item) => [`${item.idx}-${item.signature}`, item])).values()];
      }

      // Process transfer if needed (if no trades and no liquidity)
      if (result.trades.length == 0 && result.liquidities.length == 0) {
        if (parseType === 'transfer' || parseType === 'all') {
          if (!allProgramIds.some((id) => DEX_PROGRAM_IDS.includes(id))) {
            result.transfers.push(...Object.values(transferActions).flat());
          }
        }
      }
    } catch (error) {
      const msg = `Parse error: ${tx?.transaction?.signatures?.[0]} ${error}`;
      console.error(error);
      result.state = false;
      result.msg = msg;
    }

    return result;
  }

  /**
   * Parse trades from transaction
   */
  public parseTrades(tx: SolanaTransaction, config?: ParseConfig): TradeInfo[] {
    return this.parseWithClassifier(tx, config, 'trades').trades;
  }

  /**
   * Parse liquidity events from transaction
   */
  public parseLiquidity(tx: SolanaTransaction, config?: ParseConfig): PoolEvent[] {
    return this.parseWithClassifier(tx, config, 'liquidity').liquidities;
  }

  /**
   * Parse transfers from transaction (if no trades and no liquidity)
   */
  public parseTransfers(tx: SolanaTransaction, config?: ParseConfig): TransferData[] {
    return this.parseWithClassifier(tx, config, 'transfer').transfers;
  }

  /**
   * Parse both trades and liquidity events from transaction
   */
  public parseAll(tx: SolanaTransaction, config?: ParseConfig): ParseResult {
    return this.parseWithClassifier(tx, config, 'all');
  }
}
