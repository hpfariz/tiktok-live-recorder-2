#!/bin/bash

echo "Setting up TikTok Live Recorder Web Interface..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if Python3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Python3 is not installed. Please install Python3 first."
    exit 1
fi

# Check if FFmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "FFmpeg is not installed. Please install FFmpeg first."
    exit 1
fi

echo "Installing Python dependencies..."
cd src
pip3 install -r requirements.txt
cd ..

echo "Installing backend dependencies..."
cd backend
npm install
cd ..

echo "Installing frontend dependencies..."
cd frontend
npm install
cd ..

echo "Setup complete!"
echo ""
echo "To start development:"
echo "1. Backend: cd backend && npm run dev"
echo "2. Frontend: cd frontend && npm start"
echo ""
echo "To build for production:"
echo "1. cd frontend && npm run build"
echo "2. cd backend && npm start"
echo ""
echo "Make sure to configure cookies.json and telegram.json in the src/ directory before recording."