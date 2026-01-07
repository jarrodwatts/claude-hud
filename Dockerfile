FROM node:22-alpine AS base

WORKDIR /app

FROM base AS builder

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM base AS pruner

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=pruner /app/node_modules ./node_modules
COPY package.json ./

CMD ["node", "dist/index.js"]
