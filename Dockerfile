# The whole card room in one container: the server, the sync log and the web app.
#   docker build -t spades . && docker run -p 8787:8787 -v spades:/data spades
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 SPADES_DB=/data/spades.db
COPY --from=build /app /app
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "packages/server/dist/index.js"]
