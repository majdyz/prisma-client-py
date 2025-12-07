/**
 * Transaction Manager
 *
 * Manages interactive transactions for the Prisma bridge.
 * Maintains transaction state and provides access to transaction clients.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

interface TransactionState {
  id: string;
  client: Prisma.TransactionClient;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  createdAt: Date;
}

export class TransactionManager {
  private transactions: Map<string, TransactionState> = new Map();
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async start(options: { timeout: number; maxWait: number }): Promise<string> {
    const txId = randomUUID();

    return new Promise((resolveStart, rejectStart) => {
      // Start the transaction
      this.prisma.$transaction(
        async (tx) => {
          // Store the transaction client
          return new Promise<void>((resolve, reject) => {
            // Set up timeout
            const timeout = setTimeout(() => {
              this.transactions.delete(txId);
              reject(new Error(`Transaction ${txId} timed out after ${options.timeout}ms`));
            }, options.timeout);

            const state: TransactionState = {
              id: txId,
              client: tx,
              resolve,
              reject,
              timeout,
              createdAt: new Date(),
            };

            this.transactions.set(txId, state);

            // Signal that the transaction is ready
            resolveStart(txId);
          });
        },
        {
          maxWait: options.maxWait,
          timeout: options.timeout,
        }
      ).catch((error) => {
        // Transaction failed or was rolled back
        const state = this.transactions.get(txId);
        if (state) {
          clearTimeout(state.timeout);
          this.transactions.delete(txId);
        }
        // Only reject if we haven't started yet
        rejectStart(error);
      });
    });
  }

  getClient(txId: string): Prisma.TransactionClient | null {
    const state = this.transactions.get(txId);
    return state?.client || null;
  }

  async commit(txId: string): Promise<void> {
    const state = this.transactions.get(txId);
    if (!state) {
      throw new Error(`Transaction ${txId} not found`);
    }

    clearTimeout(state.timeout);
    this.transactions.delete(txId);

    // Resolve the transaction promise to commit
    state.resolve();
  }

  async rollback(txId: string): Promise<void> {
    const state = this.transactions.get(txId);
    if (!state) {
      throw new Error(`Transaction ${txId} not found`);
    }

    clearTimeout(state.timeout);
    this.transactions.delete(txId);

    // Reject the transaction promise to rollback
    state.reject(new Error('Transaction rolled back'));
  }

  // Cleanup method for graceful shutdown
  async cleanup(): Promise<void> {
    for (const [txId, state] of this.transactions) {
      clearTimeout(state.timeout);
      state.reject(new Error('Server shutting down'));
    }
    this.transactions.clear();
  }
}
