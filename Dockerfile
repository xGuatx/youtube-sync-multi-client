FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY shared/ ./shared/

EXPOSE 8080

CMD ["node", "backend/server.js"]