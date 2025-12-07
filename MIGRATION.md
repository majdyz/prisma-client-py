# Migration Guide: v0.12.x to v0.13.0 (Prisma 6+ Fork)

This guide helps you migrate from the original prisma-client-py (v0.12.x) to this fork that supports Prisma 6+.

## Table of Contents

- [Overview of Changes](#overview-of-changes)
- [Breaking Changes](#breaking-changes)
- [Migration Steps](#migration-steps)
- [API Compatibility](#api-compatibility)
- [Features Added](#features-added)
- [Troubleshooting](#troubleshooting)
- [Getting Help](#getting-help)

## Overview of Changes

### Why This Fork Exists

The original prisma-client-py was deprecated because Prisma moved from a Rust-based query engine to a TypeScript-based architecture in Prisma 5+/6+. This fork revives the project by:

1. Using a **TypeScript bridge service** instead of Rust binaries
2. Wrapping the official `@prisma/client` package
3. Maintaining the same Python API

### Architecture Change

```mermaid
graph LR
    subgraph "Before (v0.12.x)"
        A1[Python Client] --> B1[Rust Binary]
        B1 --> C1[(Database)]
    end

    subgraph "After (v0.13.0+)"
        A2[Python Client] -->|HTTP| B2[TypeScript Bridge]
        B2 --> D2[@prisma/client]
        D2 --> C2[(Database)]
    end
```

| Aspect | Before (v0.12.x) | After (v0.13.0+) |
|--------|------------------|------------------|
| Engine | Rust binary (query-engine) | TypeScript bridge service |
| Communication | Direct binary invocation | HTTP API (port 4466) |
| Platform | OS-specific binaries | Universal Node.js |
| Prisma Version | Up to 4.x | 6.x and beyond |
| Setup | `prisma py fetch` | `npm install` in bridge |

## Breaking Changes

### 1. Bridge Service Required

You must now run a TypeScript bridge service alongside your Python application.

**Setup:**
```sh
cd prisma-bridge
npm install
npm run dev  # Development
# or
npm start    # Production
```

**Docker:**
```sh
cd prisma-bridge
docker-compose up -d
```

### 2. No More Binary Downloads

The `prisma py fetch` command is deprecated and no longer downloads binaries.

**Before:**
```sh
prisma py fetch  # Downloaded Rust binaries
```

**After:**
```sh
cd prisma-bridge && npm install  # Install Node.js dependencies
```

### 3. Engine Type Configuration

The `engine_type` generator option now only supports `service`:

**Before (schema.prisma):**
```prisma
generator client {
  provider    = "prisma-client-py"
  engine_type = "binary"  # No longer supported
}
```

**After (schema.prisma):**
```prisma
generator client {
  provider    = "prisma-client-py"
  # engine_type = "service"  # Default, can be omitted
}
```

> Note: For backwards compatibility, setting `engine_type = "binary"` will emit a deprecation warning and use the service engine instead.

### 4. Environment Variables

**Removed:**
- `PRISMA_QUERY_ENGINE_BINARY` - Binary path (no longer used)
- `PRISMA_CLIENT_ENGINE_TYPE` - Always uses service now

**New:**
- `PRISMA_BRIDGE_URL` - Bridge service URL (default: `http://localhost:4466`)
- `PRISMA_CONNECTION_LIMIT` - Database connection pool size
- `PRISMA_POOL_TIMEOUT` - Connection pool timeout
- `RATE_LIMIT_ENABLED` - Enable request rate limiting
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window

### 5. Node.js Required

The bridge service requires Node.js 18+. This is a new requirement.

**Check your Node.js version:**
```sh
node --version  # Should be >= 18.0.0
```

## Migration Steps

### Step 1: Update Dependencies

```sh
pip install -U prisma
```

### Step 2: Set Up Bridge Service

```sh
# Clone/copy the prisma-bridge directory to your project
cd prisma-bridge

# Install dependencies
npm install

# Copy your schema
cp ../schema.prisma prisma/schema.prisma

# Generate Prisma client
npx prisma generate
```

### Step 3: Update Schema (if needed)

Remove or update the `engine_type` option:

```diff
generator client {
  provider    = "prisma-client-py"
- engine_type = "binary"
+ # Uses service engine by default
}
```

### Step 4: Update Environment Variables

```sh
# .env file
DATABASE_URL="postgresql://user:pass@localhost:5432/db"
PRISMA_BRIDGE_URL="http://localhost:4466"  # Optional, this is the default
```

### Step 5: Update Deployment

**Docker Compose Example:**

```yaml
version: '3.8'
services:
  prisma-bridge:
    build: ./prisma-bridge
    ports:
      - "4466:4466"
    environment:
      - DATABASE_URL=${DATABASE_URL}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4466/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  app:
    build: .
    depends_on:
      prisma-bridge:
        condition: service_healthy
    environment:
      - PRISMA_BRIDGE_URL=http://prisma-bridge:4466
```

### Step 6: Test Your Application

```sh
# Start bridge service
cd prisma-bridge && npm run dev &

# Run your tests
pytest tests/
```

## API Compatibility

The Python API remains **100% compatible**. All existing code should work without changes:

```python
# Still works exactly the same!
from prisma import Prisma

async def main():
    db = Prisma()
    await db.connect()

    user = await db.user.create(data={'name': 'Alice'})
    users = await db.user.find_many()

    await db.disconnect()
```

## Features Added

### Prometheus Metrics

The bridge service now exposes metrics at `/metrics`:

```sh
curl http://localhost:4466/metrics
```

Available metrics:
- `prisma_bridge_http_request_duration_seconds`
- `prisma_bridge_queries_total`
- `prisma_bridge_transactions_total`
- `prisma_bridge_errors_total`

### Health Checks

```sh
curl http://localhost:4466/health
# {"status":"ok","timestamp":"...","database":"connected","pool":{...}}
```

### Rate Limiting

Enable in production:

```sh
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=1000
RATE_LIMIT_WINDOW_MS=60000
```

## Troubleshooting

### "Connection refused" Error

Make sure the bridge service is running:

```sh
curl http://localhost:4466/health
```

If not running:
```sh
cd prisma-bridge && npm run dev
```

### "Database connection failed" Error

Check your `DATABASE_URL` environment variable is set for the bridge service:

```sh
# In prisma-bridge directory
export DATABASE_URL="postgresql://..."
npm run dev
```

### Deprecation Warnings

If you see deprecation warnings about engine types, update your schema:

```prisma
generator client {
  provider = "prisma-client-py"
  # Remove engine_type option or set to "service"
}
```

## Getting Help

- [GitHub Issues](https://github.com/RobertCraigie/prisma-client-py/issues)
- [Discord Community](https://discord.gg/HpFaJbepBH)
- [Documentation](https://prisma-client-py.readthedocs.io/)
