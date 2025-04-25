import { Connection } from '@solana/web3.js';
import { DexParser } from '../dex-parser';
import { ParseResult, TradeInfo, TransferInfo } from '../types';

interface SwapDetails {
  type: 'swap' | 'liquidity' | 'transfer' | 'unknown';
  dex?: string;
  inputToken?: {
    mint: string;
    amount: number;
    decimals: number;
  };
  outputToken?: {
    mint: string;
    amount: number;
    decimals: number;
  };
  user?: string;
  timestamp?: number;
  slot?: number;
  fee?: {
    mint: string;
    amount: number;
    decimals: number;
  };
  success: boolean;
  error?: string;
}

/**
 * Parse transaction details from a signature
 * @param signature - Solana transaction signature
 * @returns Swap details including tokens, amounts, and type
 */
export async function parseTransactionDetails(signature: string): Promise<SwapDetails> {
  try {
    // Initialize connection (you might want to pass this as a parameter in production)
    const connection = new Connection('https://api.mainnet-beta.solana.com');

    // Get transaction
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return {
        type: 'unknown',
        success: false,
        error: 'Transaction not found',
      };
    }

    // Initialize parser
    const parser = new DexParser();

    // Parse transaction
    const result: ParseResult = parser.parseAll(tx, {
      tryUnknowDEX: true, // Enable unknown DEX detection
    });

    // Check for parsing errors
    if (!result.state) {
      return {
        type: 'unknown',
        success: false,
        error: result.msg || 'Failed to parse transaction',
      };
    }

    // Handle DEX trades (swaps)
    if (result.trades && result.trades.length > 0) {
      const trade = result.trades[0] as TradeInfo;
      return {
        type: 'swap',
        success: true,
        dex: trade.amm,
        inputToken: trade.inputToken && {
          mint: trade.inputToken.mint || '',
          amount: Number(trade.inputToken.amount) || 0,
          decimals: Number(trade.inputToken.decimals) || 0,
        },
        outputToken: trade.outputToken && {
          mint: trade.outputToken.mint || '',
          amount: Number(trade.outputToken.amount) || 0,
          decimals: Number(trade.outputToken.decimals) || 0,
        },
        user: trade.user,
        timestamp: Number(trade.timestamp) || undefined,
        slot: Number(trade.slot) || undefined,
        fee: trade.fee && {
          mint: trade.fee.mint || '',
          amount: Number(trade.fee.amount) || 0,
          decimals: Number(trade.fee.decimals) || 0,
        },
      };
    }

    // Handle liquidity operations
    if (result.liquidities && result.liquidities.length > 0) {
      const liq = result.liquidities[0] as any;
      return {
        type: 'liquidity',
        success: true,
        dex: liq.amm,
        inputToken: {
          mint: String(liq.token0Mint) || '',
          amount: Number(liq.token0Amount) || 0,
          decimals: Number(liq.token0Decimals) || 0,
        },
        outputToken: {
          mint: String(liq.token1Mint) || '',
          amount: Number(liq.token1Amount) || 0,
          decimals: Number(liq.token1Decimals) || 0,
        },
        timestamp: Number(liq.timestamp) || undefined,
        slot: Number(liq.slot) || undefined,
      };
    }

    // Handle regular transfers
    if (result.transfers && result.transfers.length > 0) {
      const transfer = result.transfers[0] as unknown as TransferInfo;
      return {
        type: 'transfer',
        success: true,
        inputToken: {
          mint: String(transfer.token.mint) || '',
          amount: Number(transfer.token.amount) || 0,
          decimals: Number(transfer.token.decimals) || 0,
        },
        user: String(transfer.from) || '',
        timestamp: tx.blockTime || undefined,
        slot: tx.slot,
      };
    }

    // No recognized operation found
    return {
      type: 'unknown',
      success: false,
      error: 'No swap, liquidity, or transfer operation detected',
    };
  } catch (error) {
    return {
      type: 'unknown',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

// Example usage:
async function example() {
  // Jupiter swap example
  const jupiterSwap = '298EN3Eag7svjLWq62bMfaz6rL3QzE2VsZ9R2uGjfQ416umTWNaeEyBtjBDhEGTyzxzDQrzfDiA3kf3YV1S9Adnz';

  console.log('Parsing transaction...');
  const details = await parseTransactionDetails(jupiterSwap);

  if (details.success) {
    console.log('Transaction Type:', details.type);
    console.log('DEX:', details.dex);
    if (details.inputToken) {
      console.log('Input Token:', {
        mint: details.inputToken.mint,
        amount: details.inputToken.amount,
        decimals: details.inputToken.decimals,
      });
    }
    if (details.outputToken) {
      console.log('Output Token:', {
        mint: details.outputToken.mint,
        amount: details.outputToken.amount,
        decimals: details.outputToken.decimals,
      });
    }
    if (details.fee) {
      console.log('Fee:', {
        mint: details.fee.mint,
        amount: details.fee.amount,
        decimals: details.fee.decimals,
      });
    }
    console.log('User:', details.user);
    console.log('Timestamp:', details.timestamp);
    console.log('Slot:', details.slot);
  } else {
    console.error('Error:', details.error);
  }
}
example();
// Uncomment to run example:
// example().catch(console.error);
