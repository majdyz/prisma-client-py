# Prisma Bridge Service

A TypeScript bridge service that enables prisma-client-py to work with Prisma 6+ by wrapping the official `@prisma/client`.

## Overview

Prisma 6 deprecated the Rust query engine binary that prisma-client-py relied on. This bridge service provides a compatible HTTP API that translates GraphQL queries from the Python client to the TypeScript Prisma client.

## Architecture

```
┌─────────────────────┐     HTTP/JSON      ┌──────────────────────┐
│  prisma-client-py   │ ─────────────────► │   prisma-bridge      │
│  (Python Client)    │                    │   (TypeScript)       │
│                     │ ◄───────────────── │                      │
│  SyncServiceEngine  │     JSON Response  │  @prisma/client 6+   │
│  AsyncServiceEngine │                    │                      │
└─────────────────────┘                    └──────────────────────┘
                                                     │
                                                     ▼
                                           ┌──────────────────────┐
                                           │     Database         │
                                           │  (PostgreSQL, etc.)  │
                                           └──────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- A database (PostgreSQL, MySQL, SQLite, etc.)

### Installation

```bash
cd prisma-bridge
npm install
```

### Configuration

1. Create a `.env` file or set environment variables:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
PRISMA_BRIDGE_PORT=4466  # Optional, defaults to 4466
DEBUG=true               # Optional, enables query logging
```

2. Update the Prisma schema (`prisma/schema.prisma`) to match your database.

3. Generate the Prisma client:

```bash
npx prisma generate
npx prisma db push  # Or use migrations
```

### Running the Service

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

### Using with prisma-client-py

Configure prisma-client-py to use the service engine:

```python
# Option 1: Environment variable
import os
os.environ['PRISMA_CLIENT_ENGINE_TYPE'] = 'service'
os.environ['PRISMA_BRIDGE_URL'] = 'http://localhost:4466'

from prisma import Prisma

prisma = Prisma()
await prisma.connect()

# Use normally
user = await prisma.user.create(data={'name': 'Alice'})
```

Or in your Prisma schema:

```prisma
generator client {
  provider    = "prisma-client-py"
  engine_type = "service"
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | POST | Execute GraphQL query |
| `/health` | GET | Health check |
| `/health/status` | GET | Detailed health status |
| `/transaction/start` | POST | Start interactive transaction |
| `/transaction/:id/commit` | POST | Commit transaction |
| `/transaction/:id/rollback` | POST | Rollback transaction |

## Supported Operations

### CRUD Operations
- `findUnique` / `findUniqueOrThrow`
- `findFirst` / `findFirstOrThrow`
- `findMany`
- `create` / `createMany`
- `update` / `updateMany`
- `delete` / `deleteMany`
- `upsert`

### Aggregation
- `aggregate`
- `groupBy`
- `count`

### Relations
- Include (eager loading)
- Nested creates
- Nested updates

### Transactions
- Interactive transactions with commit/rollback
- Automatic transaction timeout handling

### Raw Queries
- `$queryRaw`
- `$executeRaw`

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | Database connection string (required) |
| `PRISMA_BRIDGE_PORT` | `4466` | Port to listen on |
| `DEBUG` | `false` | Enable debug logging |
| `NODE_ENV` | `development` | Environment mode |

### Python Client Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PRISMA_BRIDGE_URL` | `http://localhost:4466` | Bridge service URL |
| `PRISMA_BRIDGE_AUTO_START` | `false` | Auto-start bridge service |
| `PRISMA_CLIENT_ENGINE_TYPE` | `binary` | Engine type (`binary` or `service`) |

## Development

### Running Tests

```bash
# TypeScript unit tests
npm test

# Watch mode
npm run test:watch
```

### Project Structure

```
prisma-bridge/
├── src/
│   ├── index.ts              # Express server entry point
│   ├── prisma-client.ts      # Shared Prisma client instance
│   ├── transaction-manager.ts # Transaction state management
│   ├── parser/
│   │   └── graphql.ts        # GraphQL query parser
│   ├── translator/
│   │   ├── executor.ts       # Query executor
│   │   └── transactions.ts   # Transaction handling
│   └── routes/
│       ├── query.ts          # Query endpoint
│       ├── transaction.ts    # Transaction endpoints
│       └── health.ts         # Health check endpoint
├── __tests__/
│   └── graphql.test.ts       # Parser unit tests
├── prisma/
│   └── schema.prisma         # Prisma schema
└── package.json
```

## Troubleshooting

### Connection Refused
Ensure the bridge service is running and accessible at the configured URL.

### Query Parsing Errors
Check that your GraphQL query matches the expected format. Enable `DEBUG=true` for detailed logs.

### Transaction Timeout
Interactive transactions have a default timeout. Ensure operations complete within the timeout window.

## License

Apache-2.0 (same as prisma-client-py)
