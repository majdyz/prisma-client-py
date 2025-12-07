import { PrismaClient } from '@prisma/client';

/**
 * Prisma Client instance with connection pooling configuration.
 *
 * Connection pooling is configured via DATABASE_URL parameters:
 * - connection_limit: Maximum number of connections in the pool (default: 10)
 * - pool_timeout: How long to wait for a connection (default: 10s)
 * - connect_timeout: How long to wait for a new connection (default: 5s)
 *
 * Example DATABASE_URL with pooling:
 * postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=30
 *
 * For production high-load scenarios, consider:
 * - PgBouncer for external connection pooling
 * - Prisma Data Proxy for serverless environments
 * - Setting appropriate connection limits based on database capacity
 *
 * Environment variables:
 * - PRISMA_CONNECTION_LIMIT: Override connection limit (added to DATABASE_URL)
 * - PRISMA_POOL_TIMEOUT: Override pool timeout in seconds
 */

// Build datasource URL with connection pool parameters
function buildDatasourceUrl(): string | undefined {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return undefined;

  const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT;
  const poolTimeout = process.env.PRISMA_POOL_TIMEOUT;

  // If no overrides, return original URL
  if (!connectionLimit && !poolTimeout) {
    return baseUrl;
  }

  // Parse and modify URL
  try {
    const url = new URL(baseUrl);

    if (connectionLimit) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (poolTimeout) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }

    return url.toString();
  } catch {
    // If URL parsing fails (e.g., SQLite file: URLs), return original
    return baseUrl;
  }
}

const datasourceUrl = buildDatasourceUrl();

export const prisma = new PrismaClient({
  log: process.env.DEBUG === 'true' ? ['query', 'info', 'warn', 'error'] : ['error'],
  ...(datasourceUrl && {
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
  }),
});

// Export for health checks
export function getConnectionPoolStats() {
  return {
    connectionLimit: process.env.PRISMA_CONNECTION_LIMIT || 'default (10)',
    poolTimeout: process.env.PRISMA_POOL_TIMEOUT || 'default (10s)',
    databaseProvider: process.env.DATABASE_URL?.split(':')[0] || 'unknown',
  };
}
