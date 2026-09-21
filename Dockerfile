# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app/server

# Install with the schema present so `prisma generate` has something to read.
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci

COPY server/ ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3000
ENV PUBLIC_DIR=/app/public

COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json
COPY server/prisma ./prisma
COPY public /app/public

EXPOSE 3000

# Migrations run at boot: one instance, one owner, no coordination needed.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
