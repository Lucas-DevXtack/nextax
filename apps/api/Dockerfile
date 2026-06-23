FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 10000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
