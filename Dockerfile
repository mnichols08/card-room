# The whole card room in one container: the server, the sync log and the web app.
#   docker build -t cardroom . && docker run -p 8787:8787 -v spades:/data cardroom
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:24-slim
WORKDIR /app
# The default database, under the older setting name on purpose: a CARDROOM_DB set on the host
# still wins, and an existing SPADES_DB setting keeps meaning exactly what it did. The file keeps its
# old name too: renaming it would leave saved tables and houses behind.
ENV NODE_ENV=production PORT=8787 SPADES_DB=/data/spades.db
COPY --from=build /app /app
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "packages/server/dist/index.js"]
