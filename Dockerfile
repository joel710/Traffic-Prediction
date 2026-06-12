# Frontend — Next.js standalone build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS="--max-old-space-size=4096" npm install

COPY . .

# Prisma: generate client (needed before next build)
ARG DATABASE_URL=file:./db/custom.db
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate 2>/dev/null || echo "  ⚡ No Prisma schema found, skipping"

# Make API URLs configurable at build time (Next.js bakes NEXT_PUBLIC_* vars)
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_SIMULATOR_URL=http://localhost:8001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SIMULATOR_URL=$NEXT_PUBLIC_SIMULATOR_URL

RUN NODE_OPTIONS="--max-old-space-size=4096" npx next build
RUN cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/

# Production image
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
