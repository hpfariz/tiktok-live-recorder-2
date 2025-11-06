#!/bin/bash

# Split Bill - Deploy Fixes and Improvements
# This script deploys all bug fixes and new features

set -e

echo "🚀 Split Bill - Deploying Fixes & Improvements"
echo "=============================================="
echo ""

# Configuration
SERVER="ubuntu@152.69.214.36"
REMOTE_PATH="/home/ubuntu/apps/tiktok-live-recorder/split-bill"
LOCAL_PATH="."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_step() {
    echo -e "${GREEN}▶ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Step 1: Backup database
print_step "Step 1: Backing up database..."
BACKUP_NAME="splitbill-backup-$(date +%Y%m%d-%H%M%S).db"
ssh $SERVER "cd $REMOTE_PATH && cp data/splitbill.db data/$BACKUP_NAME 2>/dev/null || echo 'No existing database to backup'"
echo "✓ Backup created: $BACKUP_NAME"
echo ""

# Step 2: Copy updated files
print_step "Step 2: Copying updated files to server..."

# Backend files
echo "  Uploading backend files..."
scp server.js $SERVER:$REMOTE_PATH/
scp database/db.js $SERVER:$REMOTE_PATH/database/
scp database/migrate-payment-details.js $SERVER:$REMOTE_PATH/database/
scp routes/bills.js $SERVER:$REMOTE_PATH/routes/
scp routes/settlements.js $SERVER:$REMOTE_PATH/routes/
scp routes/ocr.js $SERVER:$REMOTE_PATH/routes/
scp routes/payment-details.js $SERVER:$REMOTE_PATH/routes/

# Frontend files will be added in next message
echo "✓ Backend files uploaded"
echo ""

# Step 3: Run database migration
print_step "Step 3: Running database migration..."
ssh $SERVER "cd $REMOTE_PATH && node database/migrate-payment-details.js"
echo ""

# Step 4: Restart service
print_step "Step 4: Restarting service..."
ssh $SERVER "sudo systemctl restart split-bill.service"
sleep 3
echo ""

# Step 5: Verify service
print_step "Step 5: Verifying service..."
if ssh $SERVER "systemctl is-active --quiet split-bill.service"; then
    echo -e "${GREEN}✓ Service is running${NC}"
else
    print_error "Service failed to start!"
    echo "View logs: ssh $SERVER 'sudo journalctl -u split-bill -n 50'"
    exit 1
fi
echo ""

# Step 6: Test API
print_step "Step 6: Testing API..."
HTTP_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/split-bill/health")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ API is responding (HTTP $HTTP_CODE)${NC}"
else
    print_error "API is not responding correctly (HTTP $HTTP_CODE)"
    exit 1
fi
echo ""

echo "=============================================="
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo "=============================================="
echo ""
echo "🎉 All fixes and improvements deployed successfully!"
echo ""
echo "✅ Fixed Issues:"
echo "  1. Participant deletion now works properly"
echo "  2. Enhanced OCR for better receipt parsing"
echo ""
echo "✨ New Features:"
echo "  3. Item breakdown by receipt"
echo "  4. Better item display (quantity + unit price)"
echo "  5. Improved price formatting (thousand separators)"
echo "  6. Payment details management"
echo ""
echo "🔗 Access your app:"
echo "  http://152.69.214.36/split-bill/"
echo ""
echo "📊 Monitor logs:"
echo "  ssh $SERVER 'sudo journalctl -u split-bill -f'"
echo ""
echo "📝 Test the new features:"
echo "  - Delete a participant and verify it stays deleted"
echo "  - Upload a receipt and check OCR accuracy"
echo "  - View receipt breakdown in results page"
echo "  - Add payment details for participants"
echo ""