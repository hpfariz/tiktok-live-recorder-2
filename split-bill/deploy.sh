#!/bin/bash

# Split Bill App - Quick Deployment Script
# This script automates the deployment to your OCI server

set -e

echo "🚀 Split Bill App - Deployment Script"
echo "======================================"
echo ""

# Configuration
SERVER="ubuntu@152.69.214.36"
REMOTE_PATH="/home/ubuntu/apps/tiktok-live-recorder/split-bill"
LOCAL_PATH="."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_step() {
    echo -e "${GREEN}▶ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Step 1: Check if frontend is complete
print_step "Step 1: Checking frontend completeness..."

if [ ! -f "public/single-bill.html" ] || [ ! -f "public/results.html" ]; then
    print_warning "Frontend files are missing!"
    echo ""
    echo "Missing files:"
    [ ! -f "public/single-bill.html" ] && echo "  - public/single-bill.html"
    [ ! -f "public/js/single-bill.js" ] && echo "  - public/js/single-bill.js"
    [ ! -f "public/multi-bill.html" ] && echo "  - public/multi-bill.html"
    [ ! -f "public/js/multi-bill.js" ] && echo "  - public/js/multi-bill.js"
    [ ! -f "public/results.html" ] && echo "  - public/results.html"
    [ ! -f "public/js/results.js" ] && echo "  - public/js/results.js"
    echo ""
    read -p "Deploy anyway with partial frontend? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled. Complete the frontend first."
        exit 1
    fi
fi

# Step 2: Copy files to server
print_step "Step 2: Copying files to server..."
ssh $SERVER "mkdir -p $REMOTE_PATH"
rsync -avz --exclude 'node_modules' --exclude 'data' --exclude 'uploads' --exclude '.git' \
    $LOCAL_PATH/ $SERVER:$REMOTE_PATH/
echo "✓ Files copied successfully"

# Step 3: Install dependencies
print_step "Step 3: Installing dependencies..."
ssh $SERVER "cd $REMOTE_PATH && npm install"
echo "✓ Dependencies installed"

# Step 4: Create systemd service
print_step "Step 4: Setting up systemd service..."
ssh $SERVER "sudo bash -c 'cat > /etc/systemd/system/split-bill.service << EOF
[Unit]
Description=Split Bill App
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$REMOTE_PATH
Environment=\"PORT=3001\"
Environment=\"NODE_ENV=production\"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF'"

ssh $SERVER "sudo systemctl daemon-reload"
ssh $SERVER "sudo systemctl enable split-bill.service"
echo "✓ Systemd service created"

# Step 5: Start service
print_step "Step 5: Starting service..."
ssh $SERVER "sudo systemctl restart split-bill.service"
sleep 2

# Check if service is running
if ssh $SERVER "systemctl is-active --quiet split-bill.service"; then
    echo "✓ Service started successfully"
else
    print_error "Service failed to start!"
    echo "Check logs with: ssh $SERVER 'sudo journalctl -u split-bill -n 50'"
    exit 1
fi

# Step 6: Configure Nginx
print_step "Step 6: Configuring Nginx..."

ssh $SERVER "sudo bash -c '
if ! grep -q \"location /split-bill/\" /etc/nginx/sites-available/tiktok-recorder; then
    # Backup existing config
    cp /etc/nginx/sites-available/tiktok-recorder /etc/nginx/sites-available/tiktok-recorder.backup

    # Add split-bill location before tiktok-recorder location
    sed -i \"/location \/tiktok-recorder\//i\\
    # Split Bill App\\n\\
    location /split-bill/ {\\n\\
        proxy_pass http://127.0.0.1:3001;\\n\\
        proxy_http_version 1.1;\\n\\
        proxy_set_header Upgrade \\\$http_upgrade;\\n\\
        proxy_set_header Connection '\"'upgrade'\"';\\n\\
        proxy_set_header Host \\\$host;\\n\\
        proxy_set_header X-Real-IP \\\$remote_addr;\\n\\
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;\\n\\
        proxy_set_header X-Forwarded-Proto \\\$scheme;\\n\\
        proxy_cache_bypass \\\$http_upgrade;\\n\\
        proxy_buffering off;\\n\\
        client_max_body_size 10M;\\n\\
    }\\n\\
    \\n\\
    location = /split-bill {\\n\\
        return 301 /split-bill/;\\n\\
    }\\n\\
\" /etc/nginx/sites-available/tiktok-recorder

    echo \"Nginx configuration added\"
else
    echo \"Nginx configuration already exists\"
fi
'"

# Test nginx configuration
if ssh $SERVER "sudo nginx -t 2>&1 | grep -q successful"; then
    ssh $SERVER "sudo systemctl reload nginx"
    echo "✓ Nginx configured and reloaded"
else
    print_error "Nginx configuration test failed!"
    echo "Check config manually"
fi

# Step 7: Update homepage
print_step "Step 7: Updating homepage..."

ssh $SERVER "sudo bash -c '
if ! grep -q \"split-bill\" /var/www/homepage/index.html; then
    # Backup existing homepage
    cp /var/www/homepage/index.html /var/www/homepage/index.html.backup

    # Add split-bill card (add before the \"Coming Soon\" card)
    sed -i \"s|<div class=\\\"service-card\\\" style=\\\"opacity: 0.6|<a href=\\\"/split-bill\\\" class=\\\"service-card\\\">\\n                <div class=\\\"service-icon\\\">💸</div>\\n                <div class=\\\"service-title\\\">Split Bill</div>\\n                <div class=\\\"service-description\\\">\\n                    Split bills fairly with OCR receipt scanning\\n                </div>\\n            </a>\\n            \\n            <div class=\\\"service-card\\\" style=\\\"opacity: 0.6|\" /var/www/homepage/index.html

    echo \"Homepage updated\"
else
    echo \"Homepage already has split-bill link\"
fi
'"

echo "✓ Homepage updated"

# Step 8: Final checks
print_step "Step 8: Running final checks..."

echo ""
echo "Service status:"
ssh $SERVER "systemctl status split-bill.service --no-pager -l"

echo ""
echo "======================================"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo "======================================"
echo ""
echo "Access your app at:"
echo "  🌐 http://152.69.214.36/split-bill/"
echo ""
echo "Useful commands:"
echo "  View logs:    ssh $SERVER 'sudo journalctl -u split-bill -f'"
echo "  Restart:      ssh $SERVER 'sudo systemctl restart split-bill'"
echo "  Stop:         ssh $SERVER 'sudo systemctl stop split-bill'"
echo "  Check status: ssh $SERVER 'systemctl status split-bill'"
echo ""
echo "Data locations on server:"
echo "  App:        $REMOTE_PATH"
echo "  Database:   $REMOTE_PATH/data/splitbill.db"
echo "  Uploads:    $REMOTE_PATH/uploads/"
echo "  Logs:       sudo journalctl -u split-bill"
echo ""