# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Skip Puppeteer's Chrome download — we'll use system Chromium in production
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy manifests first for better layer caching
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json         ./apps/api/

# Install all deps (workspaces)
RUN npm ci --ignore-scripts

# Copy source and build
COPY packages/shared/ ./packages/shared/
COPY apps/api/        ./apps/api/

RUN npm run build -w packages/shared && npm run build -w apps/api

# Prune dev deps in-place (keeps workspace symlinks intact)
RUN npm prune --omit=dev --ignore-scripts

# ── Production stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Chromium + minimal dependencies for headless PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Tell Puppeteer to use the system Chromium instead of a bundled binary
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy pruned node_modules (workspace symlinks are preserved by COPY --from)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules           ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json           ./package.json

# Shared package (symlinked from node_modules/@quotebot/shared)
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared/dist         ./packages/shared/dist

# API dist + workspace-local node_modules (npm may not hoist all packages to root)
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/package.json  ./apps/api/package.json
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/dist          ./apps/api/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/node_modules  ./apps/api/node_modules

USER nodejs

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
