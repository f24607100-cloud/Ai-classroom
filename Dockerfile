# Stage 1: Build the frontend (including Rust-WASM)
# Cache-bust: 2026-04-22
FROM node:20-bookworm AS build-frontend
WORKDIR /app

# Install Rust and wasm-pack for WASM compilation
RUN apt-get update && apt-get install -y curl build-essential
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Run the server
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# Install only production dependencies
RUN npm install --omit=dev

# Copy the built artifacts from stage 1
COPY --from=build-frontend /app/dist ./dist
# Copy database configuration and schema for migrations
COPY drizzle.config.ts ./
COPY migrations ./migrations
COPY shared ./shared

# Render will provide the PORT and DATABASE_URL via environment variables
# Start the app (migrations are now handled programmatically in server/index.ts)
# Start the app directly with node to avoid npm overhead and permission issues
EXPOSE 5000
CMD ["node", "dist/index.cjs"]




