FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack pnpm_config_store_dir=/pnpm/store
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
RUN pnpm --filter @folio/shared build && pnpm --filter @folio/backend db:generate && pnpm --filter @folio/backend build
RUN mkdir /data && chown -R node:node /data /pnpm
USER node
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @folio/backend db:migrate && pnpm --filter @folio/backend start"]
