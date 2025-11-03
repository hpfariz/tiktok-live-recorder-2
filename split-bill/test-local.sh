#!/bin/bash

# Split Bill App - Local Test Script
# Run this to test the app locally before deploying

echo "🧪 Testing Split Bill App"
echo "========================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    echo "Please install Node.js 16+ first"
    exit 1
fi

echo -e "${GREEN}✓ Node.js found:${NC} $(node -v)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ npm found:${NC} $(npm -v)"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if all required files exist
echo "📋 Checking files..."

required_files=(
    "server.js"
    "package.json"
    "database/db.js"
    "database/cleanup.js"
    "routes/bills.js"
    "routes/settlements.js"
    "public/index.html"
    "public/single-bill.html"
    "public/multi-bill.html"
    "public/results.html"
    "public/css/style.css"
    "public/js/ocr.js"
    "public/js/single-bill.js"
    "public/js/multi-bill.js"
    "public/js/results.js"
)

all_found=true
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file"
    else
        echo -e "${RED}✗${NC} $file (MISSING)"
        all_found=false
    fi
done

if [ "$all_found" = false ]; then
    echo ""
    echo -e "${RED}Some files are missing!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ All files present!${NC}"
echo ""

# Start the server
echo "🚀 Starting server..."
echo ""
echo "The app will be available at:"
echo "  → http://localhost:3001/split-bill/"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""
echo "==========================================="
echo ""

# Run the server
PORT=3001 node server.js