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
ENV ORBIT_DATA_DIR=/data/orbit

WORKDIR /app
COPY --from=build /app/.output ./.output

VOLUME ["/data/orbit"]
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
