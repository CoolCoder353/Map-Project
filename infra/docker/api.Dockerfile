# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.26.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @wayfinder/shared --filter @wayfinder/core --filter @wayfinder/api
COPY packages/shared packages/shared
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @wayfinder/shared --filter @wayfinder/core --filter @wayfinder/api build \
 && pnpm --filter @wayfinder/api deploy --prod --legacy /out

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY infra/map-assets /app/map-assets
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
