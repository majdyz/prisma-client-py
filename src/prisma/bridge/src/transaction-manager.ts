/**
 * Shared Transaction Manager instance
 */

import { prisma } from './prisma-client';
import { TransactionManager } from './translator/transactions';

// Single shared transaction manager instance
export const txManager = new TransactionManager(prisma);
