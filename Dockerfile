# Use Node.js as base image since we need both Node and Python
FROM node:18-bullseye

# Install system dependencies in a single layer
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install rclone
RUN curl https://rclone.org/install.sh | bash

# Set working directory
WORKDIR /app

# Copy and install Node.js dependencies first (better caching)
COPY package.json ./
RUN npm ci --only=production

# Copy and install Python dependencies with optimizations
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --compile -r requirements.txt

# Copy source code
COPY . .

# Create recordings directory
RUN mkdir -p recordings

# Expose port
EXPOSE 10000

# Set environment to production
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Start the application
CMD ["npm", "start"]