# Prisma Bridge Service Dockerfile
# Multi-stage build for minimal production image

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install security updates
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S prisma -u 1001

# Copy built application
COPY --from=builder --chown=prisma:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=prisma:nodejs /app/dist ./dist
COPY --from=builder --chown=prisma:nodejs /app/prisma ./prisma
COPY --from=builder --chown=prisma:nodejs /app/package.json ./

# Set environment
ENV NODE_ENV=production
ENV PRISMA_BRIDGE_PORT=4466

# Expose port
EXPOSE 4466

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4466/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Switch to non-root user
USER prisma

# Start server
CMD ["node", "dist/index.js"]
