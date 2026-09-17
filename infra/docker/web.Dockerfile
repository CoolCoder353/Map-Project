# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.26.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/nav/package.json packages/nav/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @wayfinder/shared --filter @wayfinder/nav --filter @wayfinder/web
COPY packages/shared packages/shared
COPY packages/nav packages/nav
COPY apps/web apps/web
RUN pnpm --filter @wayfinder/web build

FROM caddy:2
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv/web
