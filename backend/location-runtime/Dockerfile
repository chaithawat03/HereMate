# M2 Staging candidate only. Pin digest and scan base image before deployment.
# Build context is repository root: docker build -f backend/location-runtime/Dockerfile .
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ENV NODE_ENV=production
WORKDIR /srv/heremate/runtime
COPY backend/location-runtime/package.json backend/location-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
WORKDIR /srv/heremate
COPY backend/location/location-service.mjs backend/location/firestore-location-adapters.mjs backend/location/http.mjs ./location/
COPY backend/location-runtime/edge.mjs backend/location-runtime/main.mjs ./runtime/
WORKDIR /srv/heremate/runtime
USER node
EXPOSE 8080
CMD ["node","main.mjs"]
