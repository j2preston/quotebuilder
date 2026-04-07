# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./
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

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy pruned node_modules (workspace symlinks are preserved by COPY --from)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules           ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json           ./package.json

# Shared package (symlinked from node_modules/@quotebot/shared)
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared/dist         ./packages/shared/dist

# API dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/package.json  ./apps/api/package.json
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/dist          ./apps/api/dist

USER nodejs

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
