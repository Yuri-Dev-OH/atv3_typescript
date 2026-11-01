FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
CMD ["node", "dist/src/catalog-server.js"]
#https://www.youtube.com/watch?v=dQw4w9WgXcQ