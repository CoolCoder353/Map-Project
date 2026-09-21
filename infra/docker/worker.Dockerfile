# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.26.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @wayfinder/shared --filter @wayfinder/core --filter @wayfinder/worker
COPY packages/shared packages/shared
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @wayfinder/shared --filter @wayfinder/core --filter @wayfinder/worker build \
 && pnpm --filter @wayfinder/worker deploy --prod --legacy /out

# Jobs only, no map-data building (no Java, GraphHopper, Planetiler or osmium): for small
# servers whose map data is built elsewhere. `docker build --target slim`.
FROM node:24-bookworm-slim AS slim
ENV NODE_ENV=production
RUN mkdir -p /data && chown -R node:node /data
WORKDIR /app
COPY --from=build /out /app
USER node
CMD ["node", "dist/main.js"]

FROM eclipse-temurin:21-jre AS jre

FROM node:24-bookworm-slim
ARG GRAPHHOPPER_VERSION=11.0
ARG PLANETILER_VERSION=0.10.2
ENV NODE_ENV=production JAVA_HOME=/opt/java/openjdk PATH="/opt/java/openjdk/bin:${PATH}"
RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ADD https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/${GRAPHHOPPER_VERSION}/graphhopper-web-${GRAPHHOPPER_VERSION}.jar /opt/graphhopper/graphhopper-web.jar
ADD https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar /opt/planetiler/planetiler.jar
COPY infra/graphhopper/config.yml /opt/graphhopper/config.yml
COPY infra/graphhopper/custom_models /opt/graphhopper/custom_models
RUN chmod 0644 /opt/graphhopper/graphhopper-web.jar /opt/planetiler/planetiler.jar
# The data volume is owned by the app user: a fresh named volume inherits this ownership,
# so the worker can write the OSM extract, graph, tiles and temp files.
RUN mkdir -p /data/osm /data/graphhopper /data/tiles /data/sources /data/tmp && chown -R node:node /data
WORKDIR /app
COPY --from=build /out /app
USER node
CMD ["node", "dist/main.js"]
