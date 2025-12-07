import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Rate limiting configuration for the Prisma Bridge.
 *
 * Environment variables:
 * - RATE_LIMIT_ENABLED: Set to 'true' to enable rate limiting (default: false)
 * - RATE_LIMIT_WINDOW_MS: Time window in milliseconds (default: 60000 = 1 minute)
 * - RATE_LIMIT_MAX_REQUESTS: Max requests per window (default: 1000)
 * - RATE_LIMIT_TRUST_PROXY: Set to 'true' if behind a reverse proxy
 *
 * For production deployments behind a load balancer, you may want to:
 * 1. Enable RATE_LIMIT_TRUST_PROXY
 * 2. Use a distributed rate limiter (Redis-based) for multi-instance deployments
 */

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED === 'true';
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000', 10);

// Standard response format matching our API
const rateLimitResponse = (req: Request, res: Response) => {
  res.status(429).json({
    data: null,
    errors: [{
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    }],
  });
};

// Skip rate limiting for health checks and metrics
const skip = (req: Request) => {
  return req.path === '/health' ||
         req.path === '/health/status' ||
         req.path === '/metrics';
};

/**
 * General rate limiter for all query/mutation endpoints
 */
export const generalRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  message: rateLimitResponse as any,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !RATE_LIMIT_ENABLED || skip(req),
  keyGenerator: (req) => {
    // Use X-Forwarded-For if behind proxy, otherwise use IP
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
           req.ip ||
           'unknown';
  },
});

/**
 * Stricter rate limiter for transaction operations
 * Transactions are more resource-intensive, so we apply stricter limits
 */
export const transactionRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Math.floor(MAX_REQUESTS / 5), // 5x stricter for transactions
  message: rateLimitResponse as any,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !RATE_LIMIT_ENABLED,
  keyGenerator: (req) => {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
           req.ip ||
           'unknown';
  },
});

/**
 * Configuration getter for logging
 */
export function getRateLimitConfig() {
  return {
    enabled: RATE_LIMIT_ENABLED,
    windowMs: WINDOW_MS,
    maxRequests: MAX_REQUESTS,
    transactionMaxRequests: Math.floor(MAX_REQUESTS / 5),
  };
}
