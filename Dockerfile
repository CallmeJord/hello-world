# Lobby + lockstep relay server (also serves the web client).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY www ./www
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/server.js"]
