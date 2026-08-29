FROM node:22-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV ORBIT_VAULT_DIR=/vault

WORKDIR /app
COPY --from=build /app/.output ./.output

VOLUME ["/vault"]
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
