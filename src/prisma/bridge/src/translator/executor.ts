/**
 * Query Executor
 *
 * Executes parsed GraphQL queries against the Prisma TypeScript client.
 */

import { PrismaClient } from '@prisma/client';
import { ParsedQuery, selectionsToInclude } from '../parser/graphql';

type PrismaClientAny = PrismaClient | any;

export async function executeQuery(prisma: PrismaClientAny, query: ParsedQuery): Promise<any> {
  const { action, model, args } = query;

  // Handle raw queries specially
  if (action === 'queryRaw') {
    return executeRawQuery(prisma, args);
  }
  if (action === 'executeRaw') {
    return executeRawExecute(prisma, args);
  }

  // Get the model accessor (e.g., prisma.user)
  const modelName = model.charAt(0).toLowerCase() + model.slice(1);
  const modelAccessor = (prisma as any)[modelName];

  if (!modelAccessor) {
    throw new Error(`Model '${model}' not found. Available models: ${Object.keys(prisma).filter(k => !k.startsWith('$') && !k.startsWith('_')).join(', ')}`);
  }

  // Build the Prisma query arguments
  const prismaArgs = buildPrismaArgs(query);

  console.log(`Executing: prisma.${modelName}.${action}(${JSON.stringify(prismaArgs)})`);

  // Execute the appropriate action
  switch (action) {
    case 'findUnique':
      return modelAccessor.findUnique(prismaArgs);

    case 'findUniqueOrThrow':
      return modelAccessor.findUniqueOrThrow(prismaArgs);

    case 'findFirst':
      return modelAccessor.findFirst(prismaArgs);

    case 'findFirstOrThrow':
      return modelAccessor.findFirstOrThrow(prismaArgs);

    case 'findMany':
      return modelAccessor.findMany(prismaArgs);

    case 'create':
      return modelAccessor.create(prismaArgs);

    case 'createMany':
      return modelAccessor.createMany(prismaArgs);

    case 'update':
      return modelAccessor.update(prismaArgs);

    case 'updateMany':
      return modelAccessor.updateMany(prismaArgs);

    case 'delete':
      return modelAccessor.delete(prismaArgs);

    case 'deleteMany':
      return modelAccessor.deleteMany(prismaArgs);

    case 'upsert':
      return modelAccessor.upsert(prismaArgs);

    case 'count':
      return handleCount(modelAccessor, prismaArgs, query);

    case 'aggregate':
      return handleAggregate(modelAccessor, args, query);

    case 'groupBy':
      return modelAccessor.groupBy(prismaArgs);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

function buildPrismaArgs(query: ParsedQuery): Record<string, any> {
  const { args, selections } = query;
  const prismaArgs: Record<string, any> = {};

  // Copy over standard arguments
  if (args.where) prismaArgs.where = args.where;
  if (args.data) prismaArgs.data = args.data;
  if (args.create) prismaArgs.create = args.create;
  if (args.update) prismaArgs.update = args.update;
  if (args.take !== undefined) prismaArgs.take = args.take;
  if (args.skip !== undefined) prismaArgs.skip = args.skip;
  if (args.cursor) prismaArgs.cursor = args.cursor;
  if (args.distinct) prismaArgs.distinct = args.distinct;

  // Handle orderBy (Python uses order_by or orderBy)
  if (args.orderBy || args.order_by) {
    prismaArgs.orderBy = args.orderBy || args.order_by;
  }

  // Handle include from args (explicit include)
  if (args.include) {
    prismaArgs.include = args.include;
  }

  // Handle skipDuplicates for createMany
  if (args.skipDuplicates !== undefined) {
    prismaArgs.skipDuplicates = args.skipDuplicates;
  }

  // For groupBy
  if (args.by) prismaArgs.by = args.by;
  if (args.having) prismaArgs.having = args.having;

  // If no explicit include but selections have relations, derive include from selections
  if (!prismaArgs.include && selections.length > 0) {
    const derivedInclude = selectionsToInclude(selections);
    if (derivedInclude) {
      prismaArgs.include = derivedInclude;
    }
  }

  return prismaArgs;
}

async function handleCount(
  modelAccessor: any,
  args: Record<string, any>,
  query: ParsedQuery
): Promise<any> {
  // Check if we need aggregate count (with _count selection)
  const rawSelection = query.rawSelectionString || '';

  if (rawSelection.includes('_count')) {
    // Use aggregate for detailed count
    const result = await modelAccessor.aggregate({
      where: args.where,
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
      _count: true,
    });

    return {
      _count: result._count,
    };
  }

  // Simple count
  return modelAccessor.count({
    where: args.where,
    take: args.take,
    skip: args.skip,
    cursor: args.cursor,
  });
}

async function handleAggregate(
  modelAccessor: any,
  args: Record<string, any>,
  query: ParsedQuery
): Promise<any> {
  const rawSelection = query.rawSelectionString || '';
  const aggregateArgs: Record<string, any> = {};

  // Copy standard filtering arguments
  if (args.where) aggregateArgs.where = args.where;
  if (args.take !== undefined) aggregateArgs.take = args.take;
  if (args.skip !== undefined) aggregateArgs.skip = args.skip;
  if (args.cursor) aggregateArgs.cursor = args.cursor;
  if (args.orderBy || args.order_by) aggregateArgs.orderBy = args.orderBy || args.order_by;

  // Parse the selection to determine which aggregations to include
  // Check for common aggregation patterns
  if (rawSelection.includes('_count')) {
    aggregateArgs._count = true;
  }
  if (rawSelection.includes('_avg')) {
    aggregateArgs._avg = true;
  }
  if (rawSelection.includes('_sum')) {
    aggregateArgs._sum = true;
  }
  if (rawSelection.includes('_min')) {
    aggregateArgs._min = true;
  }
  if (rawSelection.includes('_max')) {
    aggregateArgs._max = true;
  }

  // If no aggregation specified, default to count
  if (!aggregateArgs._count && !aggregateArgs._avg && !aggregateArgs._sum &&
      !aggregateArgs._min && !aggregateArgs._max) {
    aggregateArgs._count = true;
  }

  return modelAccessor.aggregate(aggregateArgs);
}

// Helper to convert BigInt to string for JSON serialization
function serializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInts);
  }
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

async function executeRawQuery(prisma: PrismaClientAny, args: Record<string, any>): Promise<any> {
  const { query, parameters } = args;

  if (!query) {
    throw new Error('Raw query requires a query string');
  }

  // Parse parameters if they're a JSON string
  let params: any[] = [];
  if (parameters) {
    try {
      params = typeof parameters === 'string' ? JSON.parse(parameters) : parameters;
    } catch {
      params = [parameters];
    }
  }

  // Use $queryRawUnsafe for dynamic queries
  const result = await prisma.$queryRawUnsafe(query, ...params);
  // Convert BigInt to strings for JSON serialization
  return serializeBigInts(result);
}

async function executeRawExecute(prisma: PrismaClientAny, args: Record<string, any>): Promise<number> {
  const { query, parameters } = args;

  if (!query) {
    throw new Error('Raw execute requires a query string');
  }

  // Parse parameters if they're a JSON string
  let params: any[] = [];
  if (parameters) {
    try {
      params = typeof parameters === 'string' ? JSON.parse(parameters) : parameters;
    } catch {
      params = [parameters];
    }
  }

  // Use $executeRawUnsafe for dynamic queries
  return prisma.$executeRawUnsafe(query, ...params);
}
