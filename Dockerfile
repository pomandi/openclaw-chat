FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache bash
COPY package.json package-lock.json ./
COPY scripts ./scripts
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

# Copy Edge TTS dependencies (for voice mode)
COPY --from=builder /app/node_modules/node-edge-tts ./node_modules/node-edge-tts
RUN --mount=from=builder,source=/app/node_modules,target=/tmp/nm \
    for pkg in https-proxy-agent agent-base debug ms yargs yargs-parser cliui \
               escalade get-caller-file require-directory y18n string-width \
               strip-ansi ansi-regex ansi-styles wrap-ansi color-convert \
               color-name emoji-regex is-fullwidth-code-point; do \
      if [ -d "/tmp/nm/$pkg" ]; then cp -r "/tmp/nm/$pkg" "./node_modules/$pkg"; fi; \
    done

# Copy PostgreSQL dependencies (use shell to copy only existing dirs)
RUN --mount=from=builder,source=/app/node_modules,target=/tmp/nm \
    for pkg in pg pg-types pg-pool pg-protocol pg-connection-string pgpass pg-int8 pg-cloudflare \
               postgres-array postgres-bytea postgres-date postgres-interval split2; do \
      if [ -d "/tmp/nm/$pkg" ]; then cp -r "/tmp/nm/$pkg" "./node_modules/$pkg"; fi; \
    done

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
