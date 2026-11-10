# Build with: docker build -f deploy/Dockerfile -t product-insights-scrappers .
# Minimal S01/S03 image. S02 requires external CDP or a browser-capable custom image.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production SCRAPPERS_HOST=0.0.0.0 PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY tools/node-browser.mjs tools/node-server.mjs ./tools/
USER node
EXPOSE 8787
CMD ["node","tools/node-server.mjs"]
