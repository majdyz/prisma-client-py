# Binaries (DEPRECATED)

> **WARNING**: This documentation is deprecated as of v0.13.0.
>
> Prisma Client Python no longer uses Rust binaries. Instead, it uses a TypeScript bridge service
> that wraps the official `@prisma/client`. See the [Service Engine documentation](./service-engine.md)
> for the current architecture.

## Migration Information

If you're upgrading from v0.12.x or earlier, see the [Migration Guide](../../MIGRATION.md) for detailed instructions.

## New Architecture

As of v0.13.0, Prisma Client Python uses:

1. **TypeScript Bridge Service**: An Express.js server that wraps `@prisma/client`
2. **HTTP Communication**: Python client communicates with the bridge via HTTP
3. **No Binary Downloads**: Platform-specific binaries are no longer required

### Setup

```sh
# Install dependencies
cd prisma-bridge
npm install

# Start the bridge service
npm run dev  # Development
npm start    # Production
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PRISMA_BRIDGE_URL` | `http://localhost:4466` | Bridge service URL |
| `DATABASE_URL` | - | Your database connection string |

See [Service Engine](./service-engine.md) for complete documentation.

---

## Historical Reference (Pre-v0.13.0)

The following documentation is kept for historical reference only.

### Old Architecture

Prisma Client Python previously interfaced with Prisma by downloading and running Rust binaries. The source code for those binaries can be found at https://github.com/prisma/prisma-engines.

### Manual Compilation (No Longer Supported)

In versions prior to v0.13.0, you could manually compile Rust binaries:

- Clone the prisma-engines repository at the current version that the python client supports:

```
git clone https://github.com/prisma/prisma-engines --branch=5.19.0
```

- Build the binaries following the steps found [here](https://github.com/prisma/prisma-engines#building-prisma-engines)
- Make sure all 4 binaries are executable using `chmod +x <binary path>`
- Set the following environment variables:

```
PRISMA_QUERY_ENGINE_BINARY=/path/to/query-engine
PRISMA_MIGRATION_ENGINE_BINARY=/path/to/migration-engine
PRISMA_INTROSPECTION_ENGINE_BINARY=/path/to/introspection-engine
PRISMA_FMT_BINARY=/path/to/prisma-fmt
```

> **Note**: These environment variables are no longer used in v0.13.0+.
