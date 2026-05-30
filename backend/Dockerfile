FROM node:18-alpine

WORKDIR /app

# Install docker CLI for exec commands
RUN apk add --no-cache docker-cli

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
