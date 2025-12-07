import { Router } from 'express';
import { txManager } from '../transaction-manager';

export const transactionRouter = Router();

// Start a new transaction
transactionRouter.post('/start', async (req, res) => {
  try {
    const { timeout = 5000, max_wait = 2000 } = req.body;

    const txId = await txManager.start({
      timeout,
      maxWait: max_wait,
    });

    res.json({ id: txId });
  } catch (error) {
    console.error('Transaction start error:', error);
    res.status(500).json({
      data: null,
      errors: [{
        code: 'TRANSACTION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to start transaction',
      }],
    });
  }
});

// Commit a transaction
transactionRouter.post('/:txId/commit', async (req, res) => {
  try {
    const { txId } = req.params;
    await txManager.commit(txId);
    res.json({ success: true });
  } catch (error) {
    console.error('Transaction commit error:', error);
    res.status(500).json({
      data: null,
      errors: [{
        code: 'TRANSACTION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to commit transaction',
      }],
    });
  }
});

// Rollback a transaction
transactionRouter.post('/:txId/rollback', async (req, res) => {
  try {
    const { txId } = req.params;
    await txManager.rollback(txId);
    res.json({ success: true });
  } catch (error) {
    console.error('Transaction rollback error:', error);
    res.status(500).json({
      data: null,
      errors: [{
        code: 'TRANSACTION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to rollback transaction',
      }],
    });
  }
});
