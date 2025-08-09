# Use Node.js as base image since we need both Node and Python
FROM node:18-bullseye

# Install Python, FFmpeg, and rclone
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install rclone
RUN curl https://rclone.org/install.sh | bash

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm install

# Install Python dependencies
RUN pip3 install -r requirements.txt

# Copy all source files
COPY . .

# Create recordings directory
RUN mkdir -p recordings

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]