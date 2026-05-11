FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV VITE_API_TARGET=http://backend:3001

EXPOSE 3000

CMD ["npm", "run", "dev"]
