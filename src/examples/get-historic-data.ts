import { Connection, PublicKey } from '@solana/web3.js';
import { DexParser } from '../dex-parser';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { Database } from 'sqlite';

async function getHistoricData(tokenAddress: string) {
  // Initialize Solana connection
  const connection = new Connection(
    'https://solana-mainnet.api.syndica.io/api-key/21KG2L6E3kGURokSr4VwfrtYMbqnqVNYKJKCBTQv2jsiLs97iW8TQv98fcz5kvVDhS3MjVmGt91jZ3UGQpGD7zaPCuxpwgCJbek'
  );
  const parser = new DexParser();

  const db = await open({
    filename: './solana_transactions.db',
    driver: sqlite3.Database,
  });

  await createTable(db);

  let lastSignature: string | undefined;
  const batchSize = 100;

  while (true) {
    try {
      console.log('Fetching signatures before:', lastSignature);

      const signatures = await connection.getSignaturesForAddress(new PublicKey(tokenAddress), {
        limit: batchSize,
        before: lastSignature,
      });

      if (signatures.length === 0) {
        console.log('No more transactions found');
        break;
      }

      for (const sig of signatures) {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx) continue;

        const trades = parser.parseTrades(tx);

        for (const trade of trades) {
          if (trade.inputToken.mint === tokenAddress || trade.outputToken.mint === tokenAddress) {
            await insertTransaction(db, {
              signature: sig.signature,
              slot: tx.slot,
              block_time: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
              payer: trade.user,
              program_id: trade.programId || '',
              source_token: trade.inputToken.mint,
              destination_token: trade.outputToken.mint,
              amount_in: trade.inputToken.amount,
              amount_out: trade.outputToken.amount,
              fee: trade.fee?.amount || 0,
              success: tx.meta?.err === null,
              isBuy: trade.type === 'BUY' ? 1 : 0, // Add isBuy flag based on trade type
            });
          }
        }
      }

      lastSignature = signatures[signatures.length - 1].signature;
      console.log(`Processed batch. Last signature: ${lastSignature}`);

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Error processing transactions:', error);
      break;
    }
  }

  await db.close();
  console.log('Finished collecting historic data');
}

async function createTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT UNIQUE,
      slot BIGINT,
      block_time TIMESTAMP,
      payer TEXT,
      program_id TEXT,
      source_token TEXT,
      destination_token TEXT,
      amount_in NUMERIC,
      amount_out NUMERIC,
      fee NUMERIC,
      success BOOLEAN,
      isBuy INTEGER  -- Added isBuy column (1 for buy, 0 for sell)
    )
  `);
}

interface TransactionData {
  signature: string;
  slot: number;
  block_time: Date;
  payer: string;
  program_id: string;
  source_token: string;
  destination_token: string;
  amount_in: number;
  amount_out: number;
  fee: number;
  success: boolean;
  isBuy: number; // Added to interface
}

async function insertTransaction(db: Database, data: TransactionData): Promise<void> {
  const stmt = await db.prepare(`
    INSERT OR IGNORE INTO transactions (
      signature,
      slot,
      block_time,
      payer,
      program_id,
      source_token,
      destination_token,
      amount_in,
      amount_out,
      fee,
      success,
      isBuy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await stmt.run(
    data.signature,
    data.slot,
    data.block_time.toISOString(),
    data.payer,
    data.program_id,
    data.source_token,
    data.destination_token,
    data.amount_in,
    data.amount_out,
    data.fee,
    data.success ? 1 : 0,
    data.isBuy
  );

  await stmt.finalize();
}

// Usage example
const tokenAddress = '4xSMu2McgjNZboqRbJCcLZZuarBYpizawwJCgE1N9ray';
getHistoricData(tokenAddress).catch(console.error);
