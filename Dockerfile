FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy required server-side modules
COPY --from=builder /app/node_modules/ws ./node_modules/ws
COPY --from=builder /app/node_modules/web-push ./node_modules/web-push
COPY --from=builder /app/node_modules/http_ece ./node_modules/http_ece
COPY --from=builder /app/node_modules/asn1.js ./node_modules/asn1.js
COPY --from=builder /app/node_modules/bn.js ./node_modules/bn.js
COPY --from=builder /app/node_modules/minimist ./node_modules/minimist
COPY --from=builder /app/node_modules/inherits ./node_modules/inherits
COPY --from=builder /app/node_modules/safer-buffer ./node_modules/safer-buffer

# Copy PostgreSQL dependencies
COPY --from=builder /app/node_modules/pg ./node_modules/pg
COPY --from=builder /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=builder /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=builder /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder /app/node_modules/buffer-writer ./node_modules/buffer-writer
COPY --from=builder /app/node_modules/packet-reader ./node_modules/packet-reader
COPY --from=builder /app/node_modules/pg-numeric ./node_modules/pg-numeric
COPY --from=builder /app/node_modules/obuf ./node_modules/obuf
COPY --from=builder /app/node_modules/split2 ./node_modules/split2

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
