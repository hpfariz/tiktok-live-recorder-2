# Use Node.js as base image since we need both Node and Python
FROM node:18-bullseye

# Install system dependencies and newer FFmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install newer FFmpeg from static builds (more reliable than package manager)
RUN wget -O ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" \
    && tar -xf ffmpeg.tar.xz \
    && mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ \
    && mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ \
    && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && rm -rf ffmpeg* \
    && ffmpeg -version

# Install rclone
RUN curl https://rclone.org/install.sh | bash

# Set working directory
WORKDIR /app

# Copy package files for better caching
COPY package.json package-lock.json* ./

# Install Node.js dependencies
RUN npm install --omit=dev

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