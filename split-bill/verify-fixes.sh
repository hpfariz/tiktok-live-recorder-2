#!/bin/bash

# Split Bill - Verify All Improvements Deployment
# Run this after deploying to verify everything works

echo "🔍 Split Bill - Verifying All Improvements"
echo "==========================================="
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

print_test() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Test 1: Check database schema changes
print_test "Test 1: Database Schema"

echo "Checking payment_details table..."
PAYMENT_TABLE=$(ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"payment_details\";'")

if [ "$PAYMENT_TABLE" = "payment_details" ]; then
    print_check "payment_details table exists"
else
    print_fail "payment_details table NOT found"
    echo "Run: node database/migrate-payment-details.js"
    exit 1
fi

echo "Checking items table columns..."
ITEMS_SCHEMA=$(ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'PRAGMA table_info(items);'")

if echo "$ITEMS_SCHEMA" | grep -q "quantity"; then
    print_check "quantity column exists in items table"
else
    print_fail "quantity column NOT found in items table"
fi

if echo "$ITEMS_SCHEMA" | grep -q "unit_price"; then
    print_check "unit_price column exists in items table"
else
    print_fail "unit_price column NOT found in items table"
fi

# Test 2: Check service status
print_test "Test 2: Service Status"

if ssh $SERVER "systemctl is-active --quiet split-bill.service"; then
    print_check "Service is running"
else
    print_fail "Service is NOT running"
    echo "Start with: sudo systemctl start split-bill.service"
    exit 1
fi

# Test 3: Check API endpoints
print_test "Test 3: API Endpoints"

echo "Testing health endpoint..."
HTTP_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/split-bill/health")

if [ "$HTTP_CODE" = "200" ]; then
    print_check "API is responding (HTTP $HTTP_CODE)"
else
    print_fail "API is not responding correctly (HTTP $HTTP_CODE)"
    exit 1
fi

# Test 4: Check frontend files
print_test "Test 4: Frontend Files"

echo "Checking required files..."

files=(
    "public/results.html"
    "public/js/results.js"
    "public/js/utils.js"
    "public/css/style.css"
    "public/js/single-bill.js"
    "public/js/multi-bill.js"
)

all_found=true
for file in "${files[@]}"; do
    if ssh $SERVER "[ -f $REMOTE_PATH/$file ]"; then
        print_check "$file exists"
    else
        print_fail "$file is MISSING"
        all_found=false
    fi
done

if [ "$all_found" = false ]; then
    echo ""
    echo "Some files are missing. Please redeploy."
    exit 1
fi

# Test 5: Check backend files
print_test "Test 5: Backend Files"

echo "Checking backend files..."

backend_files=(
    "routes/payment-details.js"
    "routes/ocr.js"
    "database/migrate-payment-details.js"
)

for file in "${backend_files[@]}"; do
    if ssh $SERVER "[ -f $REMOTE_PATH/$file ]"; then
        print_check "$file exists"
    else
        print_fail "$file is MISSING"
        all_found=false
    fi
done

# Test 6: Check routes registration
print_test "Test 6: Routes Registration"

echo "Checking if server.js has payment-details routes..."
if ssh $SERVER "grep -q 'payment-details' $REMOTE_PATH/server.js"; then
    print_check "Payment details routes registered in server.js"
else
    print_warn "Payment details routes may not be registered"
fi

# Test 7: Create test data and verify
print_test "Test 7: Functional Tests"

echo "Creating test bill..."
TEST_RESPONSE=$(ssh $SERVER "curl -s -X POST http://localhost:3001/split-bill/api/bills/create \
  -H 'Content-Type: application/json' \
  -d '{\"title\":\"Test Verification Bill\",\"mode\":\"single\",\"currency_symbol\":\"Rp\"}'")

TEST_BILL_ID=$(echo $TEST_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TEST_BILL_ID" ]; then
    print_check "Test bill created: $TEST_BILL_ID"
    
    # Add participant
    echo "Adding test participant..."
    PARTICIPANT_RESPONSE=$(ssh $SERVER "curl -s -X POST http://localhost:3001/split-bill/api/bills/$TEST_BILL_ID/participant \
      -H 'Content-Type: application/json' \
      -d '{\"name\":\"Test User\"}'")
    
    PARTICIPANT_ID=$(echo $PARTICIPANT_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$PARTICIPANT_ID" ]; then
        print_check "Test participant created: $PARTICIPANT_ID"
        
        # Test payment details endpoint
        echo "Testing payment details endpoint..."
        PAYMENT_DETAILS_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' \
          http://localhost:3001/split-bill/api/payment-details/$PARTICIPANT_ID")
        
        if [ "$PAYMENT_DETAILS_CODE" = "200" ]; then
            print_check "Payment details endpoint working (HTTP $PAYMENT_DETAILS_CODE)"
        else
            print_fail "Payment details endpoint failed (HTTP $PAYMENT_DETAILS_CODE)"
        fi
        
        # Test DELETE participant endpoint
        echo "Testing DELETE participant endpoint..."
        DELETE_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' -X DELETE \
          http://localhost:3001/split-bill/api/bills/participant/$PARTICIPANT_ID")
        
        if [ "$DELETE_CODE" = "200" ]; then
            print_check "DELETE participant endpoint working (HTTP $DELETE_CODE)"
        else
            print_fail "DELETE participant endpoint failed (HTTP $DELETE_CODE)"
        fi
    else
        print_warn "Could not create test participant"
    fi
    
    # Cleanup test bill
    echo "Cleaning up test data..."
    ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'DELETE FROM bills WHERE id=\"$TEST_BILL_ID\";'" 2>/dev/null
    print_check "Test data cleaned up"
else
    print_warn "Could not create test bill - manual testing recommended"
fi

# Test 8: Check logs for errors
print_test "Test 8: Recent Logs"

echo "Checking for errors in recent logs..."
ERRORS=$(ssh $SERVER "sudo journalctl -u split-bill --since '5 minutes ago' | grep -i error | wc -l")

if [ "$ERRORS" = "0" ]; then
    print_check "No errors in recent logs"
else
    print_warn "$ERRORS error(s) found in recent logs"
    echo "View logs: ssh $SERVER 'sudo journalctl -u split-bill -f'"
fi

# Test 9: Check file permissions
print_test "Test 9: File Permissions"

echo "Checking directory permissions..."
UPLOADS_PERM=$(ssh $SERVER "[ -d $REMOTE_PATH/uploads ] && [ -w $REMOTE_PATH/uploads ] && echo 'ok' || echo 'fail'")
DATA_PERM=$(ssh $SERVER "[ -d $REMOTE_PATH/data ] && [ -w $REMOTE_PATH/data ] && echo 'ok' || echo 'fail'")

if [ "$UPLOADS_PERM" = "ok" ]; then
    print_check "uploads directory is writable"
else
    print_fail "uploads directory not writable"
fi

if [ "$DATA_PERM" = "ok" ]; then
    print_check "data directory is writable"
else
    print_fail "data directory not writable"
fi

# Summary
print_test "Summary"

echo ""
echo "✅ Deployment verification complete!"
echo ""
echo "🌐 Access your app at: http://152.69.214.36/split-bill/"
echo ""
echo "📋 Features to test manually:"
echo "  1. Participant deletion - verify they don't reappear"
echo "  2. OCR with quantity items - check format"
echo "  3. Receipt breakdown tab - expand receipts"
echo "  4. Item display format - verify quantity shown"
echo "  5. Price formatting - check thousand separators"
echo "  6. Payment details - add/copy/delete"
echo ""
echo "📊 Monitor logs:"
echo "  ssh $SERVER 'sudo journalctl -u split-bill -f'"
echo ""
echo "🐛 If issues found:"
echo "  1. Check logs for errors"
echo "  2. Verify database migration ran"
echo "  3. Restart service: sudo systemctl restart split-bill"
echo "  4. Clear browser cache and retry"
echo ""