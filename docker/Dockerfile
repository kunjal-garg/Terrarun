# TerraRun - Build and serve the React app (all deps installed in Docker)
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build. API URL is resolved at runtime from same host as page (see src/utils/api.js).
COPY . .
RUN npm run build

# Serve with SPA fallback so /app, /onboarding etc. load index.html
EXPOSE 4173
ENV PORT=4173
ENV NODE_ENV=production
CMD ["npx", "serve", "dist", "-s", "--listen", "tcp://0.0.0.0:4173"]
