# ============================================================
# Fantastyczne Wspinanie — production image
# Multi-stage: the build toolchain is only needed if better-sqlite3 has no
# prebuilt binary for the platform, and never reaches the final image.
# ============================================================

FROM node:25-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:25-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/    ./src/
COPY views/  ./views/
COPY public/ ./public/

# Data directory for the SQLite database (mounted as a volume)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "src/app.js"]
