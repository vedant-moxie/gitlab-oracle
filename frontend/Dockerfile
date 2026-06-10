# DevGenie Next.js frontend — Cloud Run.
# Auth/backend env (GITLAB_CLIENT_*, NEXTAUTH_*, BACKEND_URL) is injected at
# deploy time; nothing secret is baked into the image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
# Cloud Run injects PORT (default 8080).
CMD ["sh", "-c", "npx next start -p ${PORT:-8080}"]
