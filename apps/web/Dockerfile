# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY apps/web/package.json         ./apps/web/

RUN npm ci --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY apps/web/        ./apps/web/

# VITE_API_URL is baked into the JS bundle at build time
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build -w packages/shared && npm run build -w apps/web

# ── Serve stage ────────────────────────────────────────────────────────────────
FROM nginx:alpine AS production

COPY --from=builder /app/apps/web/dist     /usr/share/nginx/html
COPY apps/web/nginx.conf.template          /tmp/nginx.conf.template

EXPOSE 80

CMD ["sh", "-c", "cp /tmp/nginx.conf.template /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
