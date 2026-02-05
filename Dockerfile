# Stage 1: Build
FROM node:18-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript (if needed for production)
# RUN pnpm build

# Stage 2: Production
FROM node:18-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer/Playwright to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_BROWSERS_PATH=/usr/bin/chromium-browser

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built files and source from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/sql ./sql
COPY --from=builder /app/scripts ./scripts

# Create necessary directories
RUN mkdir -p /app/data/exports /app/logs

# Set environment
ENV NODE_ENV=production \
    PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/scheduler/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["pnpm", "dev"]
