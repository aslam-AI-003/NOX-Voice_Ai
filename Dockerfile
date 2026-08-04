# NOX Voice AI — Production Dockerfile
FROM node:18-slim

# Install Python for edge-tts
RUN apt-get update && apt-get install -y python3 python3-pip && \
    pip3 install edge-tts --break-system-packages && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Render uses PORT env variable (default 10000)
ENV PORT=10000

EXPOSE 10000

CMD ["node", "src/index.js"]
