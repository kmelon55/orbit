# syntax=docker/dockerfile:1
ARG ORBIT_BUILD_DNS=default

FROM node:22-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM dependencies AS dependencies-default
RUN pnpm install --frozen-lockfile

# Optional build-only resolver for hosts whose LAN DNS is unreachable from Docker.
FROM dependencies AS dependencies-public
RUN --mount=type=bind,source=build-resolv.conf,target=/etc/resolv.conf \
    pnpm install --frozen-lockfile

FROM dependencies-${ORBIT_BUILD_DNS} AS build
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
