# TerraRun API server (PostgreSQL + Prisma, Strava OAuth, sessions). Deps installed in Docker only.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
EXPOSE 8787
CMD ["node", "index.js"]
