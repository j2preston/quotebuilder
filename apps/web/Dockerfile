# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY apps/web/package.json         ./apps/web/

RUN npm ci --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY apps/web/        ./apps/web/

RUN npm run build -w packages/shared && npm run build -w apps/web

# ── Serve stage ────────────────────────────────────────────────────────────────
FROM nginx:alpine AS production

COPY --from=builder /app/apps/web/dist     /usr/share/nginx/html
COPY apps/web/nginx.conf.template          /tmp/nginx.conf.template

EXPOSE 80

# At startup, replace __API_URL__ placeholder and launch nginx
CMD ["/bin/sh", "-c", \
     "sed 's|__API_URL__|'\"${API_URL:-http://localhost:3001}\"'|g' \
      /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf \
     && exec nginx -g 'daemon off;'"]
