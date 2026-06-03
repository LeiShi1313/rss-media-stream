FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS dev
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci
COPY . .
EXPOSE 4000 5173
CMD ["npm", "run", "dev"]

FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/tsconfig.json /app/tsconfig.base.json ./
EXPOSE 4000
CMD ["sh", "-c", "npm run prisma:push -- --accept-data-loss && npm start"]
