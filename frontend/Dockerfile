FROM node:24-bookworm-slim
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
RUN pnpm --filter @folio/shared build
EXPOSE 5173
CMD ["pnpm", "--filter", "@folio/frontend", "dev"]
