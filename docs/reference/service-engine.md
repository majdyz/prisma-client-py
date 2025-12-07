# Service Engine (Prisma 6+ Support)

The Service Engine enables prisma-client-py to work with Prisma 6 and later versions by using a TypeScript bridge service instead of the deprecated Rust query engine binary.

## Why Service Engine?

Starting with Prisma 6, the standalone Rust query engine binary was deprecated in favor of the TypeScript-based `@prisma/client`. The Service Engine provides a bridge between prisma-client-py and the official TypeScript client, ensuring continued compatibility with modern Prisma versions.

## Quick Start

### 1. Set up the Bridge Service

```bash
# Navigate to the bridge directory
cd prisma-bridge

# Install dependencies
npm install

# Configure your database
echo 'DATABASE_URL="postgresql://user:pass@localhost:5432/db"' > .env

# Update schema and generate client
npx prisma db push
npx prisma generate

# Start the service
npm run dev
```

### 2. Configure Python Client

Set the engine type to `service`:

```python
import os
os.environ['PRISMA_CLIENT_ENGINE_TYPE'] = 'service'

from prisma import Prisma

async def main():
    prisma = Prisma()
    await prisma.connect()

    # Use the client as normal
    user = await prisma.user.create(
        data={'name': 'Alice', 'email': 'alice@example.com'}
    )
    print(user)

    await prisma.disconnect()
```

Or configure in your Prisma schema:

```prisma
generator client {
  provider    = "prisma-client-py"
  engine_type = "service"
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PRISMA_CLIENT_ENGINE_TYPE` | `binary` | Set to `service` to use the bridge |
| `PRISMA_BRIDGE_URL` | `http://localhost:4466` | URL of the bridge service |
| `PRISMA_BRIDGE_AUTO_START` | `false` | Auto-start bridge if not running |

### Programmatic Configuration

```python
from prisma import Prisma
from prisma.engine import SyncServiceEngine

# Custom service URL
engine = SyncServiceEngine(
    dml_path=Path('prisma/schema.prisma'),
    service_url='http://custom-host:4466',
    log_queries=True,
)

prisma = Prisma()
prisma._internal_engine = engine
await prisma.connect()
```

## Synchronous vs Asynchronous

Both sync and async clients are supported:

```python
# Async client
from prisma import Prisma

prisma = Prisma()
await prisma.connect()
users = await prisma.user.find_many()

# Sync client
from prisma import Prisma

prisma = Prisma()
prisma.connect()  # No await
users = prisma.user.find_many()  # No await
```

## Transactions

Interactive transactions work the same way:

```python
async with prisma.tx() as tx:
    user = await tx.user.create(data={'name': 'Bob'})
    await tx.post.create(data={
        'title': 'Hello',
        'author_id': user.id,
    })
    # Auto-commits on success, rolls back on exception
```

## Supported Operations

All standard Prisma operations are supported:

- **CRUD**: create, read, update, delete
- **Batch**: createMany, updateMany, deleteMany
- **Queries**: findUnique, findFirst, findMany
- **Aggregation**: count, aggregate, groupBy
- **Relations**: include, nested creates
- **Raw SQL**: queryRaw, executeRaw
- **Transactions**: interactive transactions

## Production Deployment

### Docker Compose Example

```yaml
version: '3.8'

services:
  prisma-bridge:
    build: ./prisma-bridge
    ports:
      - "4466:4466"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/myapp
      - NODE_ENV=production
    depends_on:
      - db
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4466/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  app:
    build: .
    environment:
      - PRISMA_CLIENT_ENGINE_TYPE=service
      - PRISMA_BRIDGE_URL=http://prisma-bridge:4466
    depends_on:
      prisma-bridge:
        condition: service_healthy

  db:
    image: postgres:15
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=myapp
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Kubernetes Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prisma-bridge
spec:
  replicas: 2
  selector:
    matchLabels:
      app: prisma-bridge
  template:
    metadata:
      labels:
        app: prisma-bridge
    spec:
      containers:
      - name: bridge
        image: your-registry/prisma-bridge:latest
        ports:
        - containerPort: 4466
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        livenessProbe:
          httpGet:
            path: /health
            port: 4466
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/status
            port: 4466
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: prisma-bridge
spec:
  selector:
    app: prisma-bridge
  ports:
  - port: 4466
    targetPort: 4466
```

## Troubleshooting

### Bridge Not Connecting

1. Verify the bridge is running:
   ```bash
   curl http://localhost:4466/health
   ```

2. Check the URL configuration:
   ```python
   import os
   print(os.environ.get('PRISMA_BRIDGE_URL'))
   ```

3. Enable debug logging:
   ```python
   import logging
   logging.getLogger('prisma.engine._service').setLevel(logging.DEBUG)
   ```

### Query Errors

Enable query logging on both sides:

**Python:**
```python
engine = SyncServiceEngine(
    dml_path=path,
    log_queries=True,
)
```

**Bridge:**
```bash
DEBUG=true npm run dev
```

### Performance Considerations

The bridge adds network overhead compared to the binary engine. For high-performance scenarios:

1. Deploy the bridge on the same host or in the same network
2. Use connection pooling in the bridge
3. Consider batching operations where possible

## Migration from Binary Engine

1. Set up the bridge service
2. Update your Prisma schema to use `engine_type = "service"`
3. Run `prisma generate` to regenerate the client
4. Test thoroughly before deploying

No code changes should be required for standard operations.
