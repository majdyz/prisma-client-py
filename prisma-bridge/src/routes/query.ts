import { Router } from 'express';
import { prisma } from '../prisma-client';
import { parseGraphQLQuery, ParsedQuery } from '../parser/graphql';
import { executeQuery } from '../translator/executor';
import { txManager } from '../transaction-manager';

export const queryRouter = Router();

// Main query endpoint - receives GraphQL queries from Python client
queryRouter.post('/', async (req, res) => {
  try {
    // Handle both string body and JSON body
    let body = req.body;
    let query: string;
    let variables: any = {};

    // If body is a string (raw content), it could be:
    // 1. A JSON string with { query, variables }
    // 2. A raw GraphQL query string
    if (typeof body === 'string') {
      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(body);
        if (parsed.query) {
          // JSON format with query field
          query = parsed.query;
          variables = parsed.variables || {};
        } else {
          // Parsed but no query field - treat original as raw GraphQL
          query = body;
        }
      } catch (e) {
        // Not valid JSON - treat as raw GraphQL query
        query = body;
      }
    } else if (body && typeof body === 'object') {
      // Already parsed as JSON object
      if (body.query) {
        query = body.query;
        variables = body.variables || {};
      } else {
        // Object but no query field - stringify back and treat as query
        return res.status(400).json({
          data: null,
          errors: [{ code: 'BAD_REQUEST', message: 'Missing query in JSON body' }],
        });
      }
    } else {
      return res.status(400).json({
        data: null,
        errors: [{ code: 'BAD_REQUEST', message: 'Empty request body' }],
      });
    }

    if (!query) {
      console.log('Request body:', JSON.stringify(req.body));
      return res.status(400).json({
        data: null,
        errors: [{ code: 'BAD_REQUEST', message: 'Missing query field' }],
      });
    }

    // Get transaction ID from header if present
    const txId = req.headers['x-transaction-id'] as string | undefined;

    // Parse the GraphQL query to extract operation details
    const parsed = parseGraphQLQuery(query, variables);

    if (!parsed) {
      return res.status(400).json({
        data: null,
        errors: [{ code: 'PARSE_ERROR', message: 'Failed to parse query' }],
      });
    }

    console.log('Parsed query:', JSON.stringify(parsed, null, 2));

    // Get the appropriate client (transaction or main)
    const client = txId ? txManager.getClient(txId) : prisma;

    if (txId && !client) {
      return res.status(400).json({
        data: null,
        errors: [{ code: 'TRANSACTION_NOT_FOUND', message: `Transaction ${txId} not found` }],
      });
    }

    // Execute the query
    const result = await executeQuery(client || prisma, parsed);

    res.json({
      data: {
        result,
      },
    });
  } catch (error: any) {
    console.error('Query error:', error);

    // Map Prisma errors to the expected format
    const errorResponse = mapPrismaError(error);
    res.status(errorResponse.status).json({
      data: null,
      errors: [errorResponse.error],
    });
  }
});

// Error mapping from Prisma to Python client expected format
function mapPrismaError(error: any): { status: number; error: { code: string; message: string; meta?: any } } {
  // Prisma client known error
  if (error.code) {
    const statusMap: Record<string, number> = {
      P2025: 404, // Record not found
      P2002: 409, // Unique constraint violation
      P2003: 409, // Foreign key constraint violation
      P2014: 400, // Required relation violation
    };

    return {
      status: statusMap[error.code] || 400,
      error: {
        code: error.code,
        message: error.message,
        meta: error.meta,
      },
    };
  }

  // Generic error
  return {
    status: 500,
    error: {
      code: 'INTERNAL_ERROR',
      message: error.message || 'Unknown error occurred',
    },
  };
}
