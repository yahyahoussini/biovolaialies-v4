# BIOVOLAILLES — image for a VPS (see DEPLOY_VPS.md).
# One image serves both uses: demonstration (DEMO_MODE=true, demo snapshot on first start) and,
# later, the real installation (DEMO_MODE=false, empty database prepared by the operator).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# APP_URL is public (it goes into the QR codes). lib/env.ts validates the environment while
# `next build` collects page data, so the build gets a placeholder SESSION_SECRET: it is used for
# nothing at build time, and the real one is given to the container at run time, never baked in.
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL
RUN SESSION_SECRET=build-time-placeholder-never-used-at-runtime-0000 npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app ./
RUN chmod +x deploy/docker-entrypoint.sh && mkdir -p /data /app/backups
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["deploy/docker-entrypoint.sh"]
