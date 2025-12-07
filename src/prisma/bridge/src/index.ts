/**
 * Prisma Bridge Service
 *
 * HTTP bridge between prisma-client-py and @prisma/client.
 * Enables Python clients to use Prisma 6+ through a TypeScript service.
 */

import express from 'express';
import { prisma } from './prisma-client';
import { queryRouter } from './routes/query';
import { transactionRouter } from './routes/transaction';
import { healthRouter } from './routes/health';
import { metricsRouter, metricsMiddleware, trackError } from './routes/metrics';
import { generalRateLimiter, transactionRateLimiter, getRateLimitConfig } from './middleware/rate-limit';

// Re-export prisma for any modules that still import from index
export { prisma };

const app = express();
const PORT = process.env.PRISMA_BRIDGE_PORT || 4466;
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

// Logger utility
const log = {
  info: (msg: string, ...args: any[]) => console.log(`[${new Date().toISOString()}] INFO: ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => DEBUG && console.log(`[${new Date().toISOString()}] DEBUG: ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[${new Date().toISOString()}] WARN: ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`, ...args),
};

// Request ID middleware for tracing
let requestCounter = 0;
app.use((req, res, next) => {
  (req as any).requestId = `req-${++requestCounter}`;
  next();
});

// Prometheus metrics middleware (before body parsing)
app.use(metricsMiddleware);

// Custom body parser that handles both JSON and raw text
app.use((req, res, next) => {
  const startTime = Date.now();
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    data += chunk;
  });
  req.on('end', () => {
    if (data) {
      try {
        req.body = JSON.parse(data);
      } catch (e) {
        req.body = data;
      }
    } else {
      req.body = {};
    }

    // Log request completion
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const reqId = (req as any).requestId;
      if (req.path !== '/health' && req.path !== '/health/status') {
        log.info(`[${reqId}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      }
    });

    next();
  });
});

// Request logging (debug level)
app.use((req, res, next) => {
  const reqId = (req as any).requestId;
  log.debug(`[${reqId}] ${req.method} ${req.path}`);
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    log.debug(`[${reqId}] Body: ${JSON.stringify(req.body).substring(0, 500)}`);
  }
  next();
});

// Rate limiting (applied before routes)
app.use(generalRateLimiter);

// Routes
app.use('/health', healthRouter);
app.use('/metrics', metricsRouter);
app.use('/transaction', transactionRateLimiter, transactionRouter);
app.use('/', queryRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    data: null,
    errors: [{
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    }],
  });
});

// Error handling middleware
app.use((err: Error & { code?: string; meta?: any }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const reqId = (req as any).requestId;
  log.error(`[${reqId}] ${err.name}: ${err.message}`);
  if (DEBUG) {
    log.error(`[${reqId}] Stack: ${err.stack}`);
  }

  // Map Prisma errors to appropriate HTTP status codes
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let errorMessage = err.message;

  // Prisma known error codes
  if (err.code) {
    switch (err.code) {
      case 'P2002': // Unique constraint violation
        statusCode = 409;
        errorCode = 'UNIQUE_VIOLATION';
        errorMessage = `Unique constraint failed: ${err.meta?.target || 'unknown field'}`;
        break;
      case 'P2003': // Foreign key constraint violation
        statusCode = 400;
        errorCode = 'FOREIGN_KEY_VIOLATION';
        break;
      case 'P2025': // Record not found
        statusCode = 404;
        errorCode = 'NOT_FOUND';
        break;
      case 'P2010': // Raw query failed
        statusCode = 400;
        errorCode = 'RAW_QUERY_ERROR';
        break;
      default:
        if (err.code.startsWith('P')) {
          errorCode = `PRISMA_${err.code}`;
        }
    }
  }

  // Track error metrics
  trackError(err.name || 'Error', errorCode);

  res.status(statusCode).json({
    data: null,
    errors: [{
      code: errorCode,
      message: errorMessage,
      ...(DEBUG && err.meta ? { meta: err.meta } : {}),
    }],
  });
});

// Server state
let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

// Start server
async function main() {
  try {
    log.info('Connecting to database...');
    await prisma.$connect();
    log.info('Connected to database');

    server = app.listen(PORT, () => {
      log.info(`Prisma Bridge Service running on port ${PORT}`);
      log.info(`Health check: http://localhost:${PORT}/health`);
      log.info(`Prometheus metrics: http://localhost:${PORT}/metrics`);
      log.info(`Debug mode: ${DEBUG ? 'enabled' : 'disabled'}`);
      const rateLimitConfig = getRateLimitConfig();
      log.info(`Rate limiting: ${rateLimitConfig.enabled ? 'enabled' : 'disabled'}`);
      if (rateLimitConfig.enabled) {
        log.info(`  Window: ${rateLimitConfig.windowMs}ms, Max: ${rateLimitConfig.maxRequests} req/window`);
      }
    });

    // Handle server errors
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(`Port ${PORT} is already in use`);
      } else {
        log.error(`Server error: ${err.message}`);
      }
      process.exit(1);
    });

  } catch (err) {
    log.error('Failed to start server:', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`${signal} received, starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      log.info('HTTP server closed');
    });
  }

  // Wait for in-flight requests (max 30 seconds)
  const shutdownTimeout = setTimeout(() => {
    log.warn('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    await prisma.$disconnect();
    log.info('Database connection closed');
    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (err) {
    log.error('Error during shutdown:', err);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception handler
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception:', err);
  shutdown('uncaughtException');
});

main();
