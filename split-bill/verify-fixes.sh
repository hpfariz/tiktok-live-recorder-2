#!/bin/bash

# Split Bill Bug Fixes - Verification Script
# Run this after deploying fixes to verify everything is working

echo "🔍 Split Bill Bug Fixes - Verification"
echo "======================================="
echo ""

SERVER="ubuntu@152.69.214.36"
REMOTE_PATH="/home/ubuntu/apps/tiktok-live-recorder/split-bill"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_check() {
    echo -e "${GREEN}✓${NC} $1"
}

print_fail() {
    echo -e "${RED}✗${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Test 1: Check if receipt_id column exists
echo "Test 1: Checking if receipt_id column exists in payments table..."
SCHEMA=$(ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'PRAGMA table_info(payments);'")

if echo "$SCHEMA" | grep -q "receipt_id"; then
    print_check "receipt_id column exists"
else
    print_fail "receipt_id column NOT found - migration may not have run"
    exit 1
fi
echo ""

# Test 2: Check for duplicate payments
echo "Test 2: Checking for duplicate payments..."
DUPLICATES=$(ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'SELECT COUNT(*) FROM (SELECT payer_id, amount, COUNT(*) as cnt FROM payments GROUP BY payer_id, amount HAVING cnt > 1);'")

if [ "$DUPLICATES" = "0" ]; then
    print_check "No duplicate payments found"
else
    print_warn "$DUPLICATES duplicate payment groups found - cleanup may be needed"
fi
echo ""

# Test 3: Check service status
echo "Test 3: Checking service status..."
if ssh $SERVER "systemctl is-active --quiet split-bill.service"; then
    print_check "Service is running"
else
    print_fail "Service is NOT running"
    echo "View logs: ssh $SERVER 'sudo journalctl -u split-bill -n 50'"
    exit 1
fi
echo ""

# Test 4: Test API endpoint
echo "Test 4: Testing API health endpoint..."
HTTP_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/split-bill/health")

if [ "$HTTP_CODE" = "200" ]; then
    print_check "API is responding (HTTP $HTTP_CODE)"
else
    print_fail "API is not responding correctly (HTTP $HTTP_CODE)"
    exit 1
fi
echo ""

# Test 5: Check specific bill (if exists)
echo "Test 5: Checking bill dcHKSxvr2M (if exists)..."
BILL_EXISTS=$(ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'SELECT COUNT(*) FROM bills WHERE id=\"dcHKSxvr2M\";'")

if [ "$BILL_EXISTS" != "0" ]; then
    print_check "Bill dcHKSxvr2M found"
    
    # Check Fariz's payment (should be 1,070,000 not 1,635,000)
    FARIZ_PAID=$(ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'SELECT TOTAL(p.amount) FROM payments p JOIN participants pt ON p.payer_id = pt.id WHERE pt.name=\"Fariz\" AND p.bill_id=\"dcHKSxvr2M\";'")
    
    echo "  - Fariz paid: Rp $FARIZ_PAID"
    
    if [ "$(echo "$FARIZ_PAID < 1100000" | bc)" = "1" ]; then
        print_check "Fariz's payment looks correct (not duplicated)"
    else
        print_warn "Fariz's payment may still have duplicates"
    fi
else
    print_warn "Bill dcHKSxvr2M not found (may have expired or been deleted)"
fi
echo ""

# Test 6: Check database size
echo "Test 6: Database health check..."
DB_SIZE=$(ssh $SERVER "du -h $REMOTE_PATH/data/splitbill.db | cut -f1")
print_check "Database size: $DB_SIZE"
echo ""

# Test 7: Check recent logs for errors
echo "Test 7: Checking recent logs for errors..."
ERRORS=$(ssh $SERVER "sudo journalctl -u split-bill --since '5 minutes ago' | grep -i error | wc -l")

if [ "$ERRORS" = "0" ]; then
    print_check "No errors in recent logs"
else
    print_warn "$ERRORS error(s) found in recent logs"
    echo "View logs: ssh $SERVER 'sudo journalctl -u split-bill -f'"
fi
echo ""

echo "======================================="
echo -e "${GREEN}✓ Verification Complete!${NC}"
echo "======================================="
echo ""
echo "Summary:"
echo "  ✓ Database schema updated"
echo "  ✓ Service running"
echo "  ✓ API responding"
echo ""
echo "Next steps:"
echo "  1. Test the app: http://152.69.214.36/split-bill/"
echo "  2. Create a new multi-bill and configure receipts multiple times"
echo "  3. Check participant breakdowns to verify tax items appear"
echo ""
echo "Monitor logs:"
echo "  ssh $SERVER 'sudo journalctl -u split-bill -f'"
echo ""