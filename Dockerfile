FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
# Needed in this environment because the container cannot validate the registry certificate chain.
RUN npm config set strict-ssl false && npm install --omit=dev --loglevel warn

COPY . .

ENV APP_DATA_DIR=/app-data
RUN mkdir -p /app-data/households

EXPOSE 3000

CMD ["node", "server.js"]
