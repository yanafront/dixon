FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build -w @dixon/api
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["npm","run","start:prod","-w","@dixon/api"]
