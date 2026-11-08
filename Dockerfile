# syntax=docker/dockerfile:1

ARG NODE_VERSION=26
ARG PNPM_VERSION=12.16.1

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Сборка TypeScript со всеми зависимостями.
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build && find dist -name '*.test.js' -delete

# Только рабочие зависимости.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production \
    STATS_DB_PATH=/app/data/stats.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
