import { Router, Request, Response, NextFunction } from 'express';
import client from 'prom-client';

export const metricsRouter = Router();

// Create a Registry for metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics for Prisma Bridge

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: 'prisma_bridge_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Request counter
export const httpRequestsTotal = new client.Counter({
  name: 'prisma_bridge_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Active requests gauge
export const activeRequests = new client.Gauge({
  name: 'prisma_bridge_active_requests',
  help: 'Number of currently active requests',
  registers: [register],
});

// Query duration histogram
export const queryDuration = new client.Histogram({
  name: 'prisma_bridge_query_duration_seconds',
  help: 'Duration of Prisma queries in seconds',
  labelNames: ['model', 'operation'],
  buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Query counter
export const queriesTotal = new client.Counter({
  name: 'prisma_bridge_queries_total',
  help: 'Total number of Prisma queries',
  labelNames: ['model', 'operation', 'status'],
  registers: [register],
});

// Transaction counter
export const transactionsTotal = new client.Counter({
  name: 'prisma_bridge_transactions_total',
  help: 'Total number of transactions',
  labelNames: ['status'], // started, committed, rolled_back
  registers: [register],
});

// Active transactions gauge
export const activeTransactions = new client.Gauge({
  name: 'prisma_bridge_active_transactions',
  help: 'Number of currently active transactions',
  registers: [register],
});

// Error counter
export const errorsTotal = new client.Counter({
  name: 'prisma_bridge_errors_total',
  help: 'Total number of errors',
  labelNames: ['type', 'code'],
  registers: [register],
});

// Metrics endpoint
metricsRouter.get('/', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Middleware to track request metrics
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip metrics endpoint itself
  if (req.path === '/metrics') {
    return next();
  }

  const start = process.hrtime.bigint();
  activeRequests.inc();

  res.on('finish', () => {
    activeRequests.dec();
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1e9;

    // Normalize route for metrics (avoid cardinality explosion)
    const route = normalizeRoute(req.path);

    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode.toString() },
      durationSeconds
    );
    httpRequestsTotal.inc(
      { method: req.method, route, status_code: res.statusCode.toString() }
    );
  });

  next();
}

// Normalize routes to prevent high cardinality
function normalizeRoute(path: string): string {
  // Replace UUIDs and CUIDs with placeholder
  let normalized = path.replace(
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
    ':id'
  );
  normalized = normalized.replace(/c[a-z0-9]{24,}/gi, ':id');

  // Common Prisma operations
  if (path.startsWith('/query')) return '/query';
  if (path.startsWith('/transaction')) {
    if (path.includes('/start')) return '/transaction/start';
    if (path.includes('/commit')) return '/transaction/:id/commit';
    if (path.includes('/rollback')) return '/transaction/:id/rollback';
    return '/transaction/:id';
  }
  if (path === '/health' || path === '/health/status') return path;
  if (path === '/metrics') return path;

  return normalized || '/';
}

// Helper to track query metrics
export function trackQuery(model: string, operation: string, durationSeconds: number, success: boolean) {
  queryDuration.observe({ model, operation }, durationSeconds);
  queriesTotal.inc({ model, operation, status: success ? 'success' : 'error' });
}

// Helper to track transaction metrics
export function trackTransactionStart() {
  transactionsTotal.inc({ status: 'started' });
  activeTransactions.inc();
}

export function trackTransactionCommit() {
  transactionsTotal.inc({ status: 'committed' });
  activeTransactions.dec();
}

export function trackTransactionRollback() {
  transactionsTotal.inc({ status: 'rolled_back' });
  activeTransactions.dec();
}

// Helper to track errors
export function trackError(type: string, code: string) {
  errorsTotal.inc({ type, code });
}
