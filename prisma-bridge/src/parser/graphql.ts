/**
 * GraphQL Query Parser
 *
 * Parses GraphQL queries from prisma-client-py into structured data
 * that can be used to call the Prisma TypeScript client.
 *
 * Example input query:
 * ```
 * query {
 *   result: findUniqueUser(
 *     where: { id: "123" }
 *   ) {
 *     id
 *     name
 *     posts { id title }
 *   }
 * }
 * ```
 *
 * Parsed output:
 * {
 *   operation: 'query',
 *   action: 'findUnique',
 *   model: 'User',
 *   args: { where: { id: '123' } },
 *   selections: ['id', 'name', { posts: ['id', 'title'] }]
 * }
 */

export interface ParsedQuery {
  operation: 'query' | 'mutation';
  action: string;
  model: string;
  args: Record<string, any>;
  selections: Selection[];
  rawSelectionString?: string;
}

export type Selection = string | { [key: string]: Selection[] };

// Map action names to their base form and extract model
// NOTE: Order matters! Longer/more specific patterns must come first
// to avoid partial matches (e.g., findUniqueOrThrow before findUnique)
const ACTION_PATTERNS: Record<string, { action: string; extractModel: boolean }> = {
  findUniqueOrThrow: { action: 'findUniqueOrThrow', extractModel: true },
  findFirstOrThrow: { action: 'findFirstOrThrow', extractModel: true },
  findUnique: { action: 'findUnique', extractModel: true },
  findFirst: { action: 'findFirst', extractModel: true },
  findMany: { action: 'findMany', extractModel: true },
  createMany: { action: 'createMany', extractModel: true },
  createOne: { action: 'create', extractModel: true },
  updateMany: { action: 'updateMany', extractModel: true },
  updateOne: { action: 'update', extractModel: true },
  deleteMany: { action: 'deleteMany', extractModel: true },
  deleteOne: { action: 'delete', extractModel: true },
  upsertOne: { action: 'upsert', extractModel: true },
  aggregate: { action: 'aggregate', extractModel: true },
  groupBy: { action: 'groupBy', extractModel: true },
  queryRaw: { action: 'queryRaw', extractModel: false },
  executeRaw: { action: 'executeRaw', extractModel: false },
};

export function parseGraphQLQuery(query: string): ParsedQuery | null {
  try {
    // Clean up the query string
    const cleanQuery = query.trim();

    // Extract operation type (query or mutation)
    const operationMatch = cleanQuery.match(/^(query|mutation)\s*\{/);
    if (!operationMatch) {
      console.error('Failed to match operation type');
      return null;
    }
    const operation = operationMatch[1] as 'query' | 'mutation';

    // Extract the result alias and method call
    // Pattern: result: methodName(args) { selections }
    const resultMatch = cleanQuery.match(/result:\s*(\w+)\s*(\([\s\S]*?\))?\s*(\{[\s\S]*\})?/);
    if (!resultMatch) {
      console.error('Failed to match result pattern');
      return null;
    }

    const fullMethodName = resultMatch[1]; // e.g., "findUniqueUser"
    const argsString = resultMatch[2] || ''; // e.g., "(where: {...})"
    const selectionsString = resultMatch[3] || ''; // e.g., "{ id name }"

    // Parse the method name to extract action and model
    const { action, model } = parseMethodName(fullMethodName);
    if (!action) {
      console.error('Failed to parse method name:', fullMethodName);
      return null;
    }

    // Parse the arguments
    const args = parseArguments(argsString);

    // Parse the selections
    const selections = parseSelections(selectionsString);

    return {
      operation,
      action,
      model,
      args,
      selections,
      rawSelectionString: selectionsString,
    };
  } catch (error) {
    console.error('Error parsing GraphQL query:', error);
    return null;
  }
}

function parseMethodName(methodName: string): { action: string; model: string } {
  // Try each known action pattern
  for (const [pattern, config] of Object.entries(ACTION_PATTERNS)) {
    if (methodName.startsWith(pattern)) {
      const model = config.extractModel ? methodName.slice(pattern.length) : '';
      return { action: config.action, model };
    }
  }

  // Try reverse - model name first patterns (e.g., "findUniqueUser" -> findUnique + User)
  // This handles cases like findUniqueUser, findManyPost, etc.
  for (const [pattern, config] of Object.entries(ACTION_PATTERNS)) {
    const regex = new RegExp(`^${pattern}(\\w+)$`);
    const match = methodName.match(regex);
    if (match) {
      return { action: config.action, model: match[1] };
    }
  }

  // Handle special case: action + model combined (findUniqueUser -> findUnique + User)
  const specialPatterns = [
    { pattern: /^findUnique(\w+?)(?:OrThrow)?$/, action: (m: RegExpMatchArray) => m[0].includes('OrThrow') ? 'findUniqueOrThrow' : 'findUnique' },
    { pattern: /^findFirst(\w+?)(?:OrThrow)?$/, action: (m: RegExpMatchArray) => m[0].includes('OrThrow') ? 'findFirstOrThrow' : 'findFirst' },
    { pattern: /^findMany(\w+)$/, action: () => 'findMany' },
    { pattern: /^createOne(\w+)$/, action: () => 'create' },
    { pattern: /^createMany(\w+)$/, action: () => 'createMany' },
    { pattern: /^updateOne(\w+)$/, action: () => 'update' },
    { pattern: /^updateMany(\w+)$/, action: () => 'updateMany' },
    { pattern: /^deleteOne(\w+)$/, action: () => 'delete' },
    { pattern: /^deleteMany(\w+)$/, action: () => 'deleteMany' },
    { pattern: /^upsertOne(\w+)$/, action: () => 'upsert' },
    { pattern: /^aggregate(\w+)$/, action: () => 'aggregate' },
    { pattern: /^groupBy(\w+)$/, action: () => 'groupBy' },
  ];

  for (const { pattern, action } of specialPatterns) {
    const match = methodName.match(pattern);
    if (match) {
      return { action: action(match), model: match[1] };
    }
  }

  // Default fallback
  return { action: methodName, model: '' };
}

function parseArguments(argsString: string): Record<string, any> {
  if (!argsString || argsString === '()') {
    return {};
  }

  // Remove the outer parentheses
  const inner = argsString.slice(1, -1).trim();
  if (!inner) {
    return {};
  }

  // This is a simplified parser - handles the GraphQL-like syntax
  // that prisma-client-py generates
  return parseGraphQLObject(inner);
}

function parseGraphQLObject(str: string): Record<string, any> {
  const result: Record<string, any> = {};
  let current = str.trim();

  while (current.length > 0) {
    // Match key: value pattern
    const keyMatch = current.match(/^(\w+)\s*:\s*/);
    if (!keyMatch) break;

    const key = keyMatch[1];
    current = current.slice(keyMatch[0].length);

    // Parse the value
    const { value, remaining } = parseValue(current);
    result[key] = value;
    current = remaining.trim();

    // Skip any commas or whitespace between entries
    current = current.replace(/^[,\s]+/, '');
  }

  return result;
}

function parseValue(str: string): { value: any; remaining: string } {
  str = str.trim();

  // String value (double-quoted)
  if (str.startsWith('"')) {
    const endQuote = findClosingQuote(str, '"');
    const value = JSON.parse(str.slice(0, endQuote + 1));
    return { value, remaining: str.slice(endQuote + 1) };
  }

  // String value (single-quoted) - convert to double for JSON.parse
  if (str.startsWith("'")) {
    const endQuote = findClosingQuote(str, "'");
    const innerValue = str.slice(1, endQuote);
    return { value: innerValue, remaining: str.slice(endQuote + 1) };
  }

  // Object value
  if (str.startsWith('{')) {
    const endBrace = findClosingBrace(str, '{', '}');
    const innerStr = str.slice(1, endBrace);
    const value = parseGraphQLObject(innerStr);
    return { value, remaining: str.slice(endBrace + 1) };
  }

  // Array value
  if (str.startsWith('[')) {
    const endBracket = findClosingBrace(str, '[', ']');
    const innerStr = str.slice(1, endBracket);
    const value = parseArray(innerStr);
    return { value, remaining: str.slice(endBracket + 1) };
  }

  // Boolean, null, or number
  const tokenMatch = str.match(/^(true|false|null|-?\d+\.?\d*)/);
  if (tokenMatch) {
    let value: any;
    const token = tokenMatch[1];
    if (token === 'true') value = true;
    else if (token === 'false') value = false;
    else if (token === 'null') value = null;
    else value = token.includes('.') ? parseFloat(token) : parseInt(token, 10);
    return { value, remaining: str.slice(token.length) };
  }

  // Identifier (enum value or other)
  const identMatch = str.match(/^(\w+)/);
  if (identMatch) {
    return { value: identMatch[1], remaining: str.slice(identMatch[1].length) };
  }

  return { value: null, remaining: str };
}

function parseArray(str: string): any[] {
  const result: any[] = [];
  let current = str.trim();

  while (current.length > 0) {
    const { value, remaining } = parseValue(current);
    result.push(value);
    current = remaining.trim().replace(/^[,\s]+/, '');
  }

  return result;
}

function findClosingQuote(str: string, quote: string): number {
  let i = 1;
  while (i < str.length) {
    if (str[i] === '\\') {
      i += 2; // Skip escaped character
    } else if (str[i] === quote) {
      return i;
    } else {
      i++;
    }
  }
  return str.length - 1;
}

function findClosingBrace(str: string, open: string, close: string): number {
  let depth = 1;
  let i = 1;
  let inString = false;
  let stringChar = '';

  while (i < str.length && depth > 0) {
    const char = str[i];

    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === stringChar) {
        inString = false;
      }
    } else {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === open) {
        depth++;
      } else if (char === close) {
        depth--;
      }
    }
    i++;
  }

  return i - 1;
}

function parseSelections(selectionsString: string): Selection[] {
  if (!selectionsString) {
    return [];
  }

  // Remove outer braces
  const inner = selectionsString.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  const selections: Selection[] = [];
  let current = inner;

  while (current.length > 0) {
    current = current.trim();

    // Match field name
    const fieldMatch = current.match(/^(\w+)/);
    if (!fieldMatch) break;

    const fieldName = fieldMatch[1];
    current = current.slice(fieldMatch[0].length).trim();

    // Check if this field has nested selections (relation)
    if (current.startsWith('{')) {
      const endBrace = findClosingBrace(current, '{', '}');
      const nestedStr = current.slice(0, endBrace + 1);
      const nestedSelections = parseSelections(nestedStr);
      selections.push({ [fieldName]: nestedSelections });
      current = current.slice(endBrace + 1);
    } else {
      selections.push(fieldName);
    }

    // Skip whitespace
    current = current.trim();
  }

  return selections;
}

// Helper to convert selections to include object for Prisma
export function selectionsToInclude(selections: Selection[]): Record<string, boolean | { include: Record<string, any> }> | undefined {
  const include: Record<string, any> = {};
  let hasRelations = false;

  for (const sel of selections) {
    if (typeof sel === 'object') {
      hasRelations = true;
      const [key, nestedSels] = Object.entries(sel)[0];
      const nestedInclude = selectionsToInclude(nestedSels as Selection[]);
      if (nestedInclude) {
        include[key] = { include: nestedInclude };
      } else {
        include[key] = true;
      }
    }
  }

  return hasRelations ? include : undefined;
}
