import { Router } from 'express';
import { prisma, getConnectionPoolStats } from '../prisma-client';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  try {
    // Quick database connectivity check
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      pool: getConnectionPoolStats(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Compatibility endpoint for existing engine protocol
healthRouter.get('/status', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({
      Errors: [{ message: error instanceof Error ? error.message : 'Unknown error' }],
    });
  }
});
