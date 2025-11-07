#!/bin/bash

# Split Bill - Verify Bug Fixes
# Run this after deployment to verify all fixes are working

echo "🔍 Split Bill - Verifying Bug Fixes"
echo "===================================="
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

print_test() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Test 1: Check files exist
print_test "Test 1: Verify Updated Files"

files=(
    "public/js/ocr.js"
    "public/js/single-bill.js"
    "public/js/ocr-google.js"
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

# Test 2: Check service status
print_test "Test 2: Service Status"

if ssh $SERVER "systemctl is-active --quiet split-bill.service"; then
    print_check "Service is running"
else
    print_fail "Service is NOT running"
    exit 1
fi

# Test 3: Check API health
print_test "Test 3: API Health"

HTTP_CODE=$(ssh $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/split-bill/health")

if [ "$HTTP_CODE" = "200" ]; then
    print_check "API is responding (HTTP $HTTP_CODE)"
else
    print_fail "API is not responding correctly (HTTP $HTTP_CODE)"
    exit 1
fi

# Test 4: Check for Tesseract references (should not exist)
print_test "Test 4: Verify Tesseract Removal"

TESSERACT_REFS=$(ssh $SERVER "grep -r 'Tesseract' $REMOTE_PATH/public/js/ 2>/dev/null | grep -v 'not used\|disabled\|removed' | wc -l")

if [ "$TESSERACT_REFS" = "0" ]; then
    print_check "No active Tesseract references found"
else
    echo "⚠️  Found $TESSERACT_REFS Tesseract references (may be in comments/warnings)"
fi

# Test 5: Check Google Vision configuration
print_test "Test 5: Google Vision Configuration"

if ssh $SERVER "[ -f $REMOTE_PATH/google-vision-key.json ]"; then
    print_check "Google Vision credentials file exists"
else
    echo "⚠️  Google Vision credentials not found"
    echo "    OCR will not work without credentials"
    echo "    Place google-vision-key.json in $REMOTE_PATH/"
fi

# Test 6: Check recent logs for errors
print_test "Test 6: Check Recent Logs"

ERRORS=$(ssh $SERVER "sudo journalctl -u split-bill --since '5 minutes ago' | grep -i 'error\|failed' | grep -v 'No entries\|no journal files' | wc -l")

if [ "$ERRORS" = "0" ]; then
    print_check "No errors in recent logs"
else
    echo "⚠️  Found $ERRORS error/warning message(s)"
    echo "    View logs: ssh $SERVER 'sudo journalctl -u split-bill -n 50'"
fi

# Test 7: Check JavaScript syntax
print_test "Test 7: JavaScript Syntax Check"

echo "Checking single-bill.js..."
SINGLE_SYNTAX=$(ssh $SERVER "node -c $REMOTE_PATH/public/js/single-bill.js 2>&1")

if [ -z "$SINGLE_SYNTAX" ]; then
    print_check "single-bill.js syntax OK"
else
    print_fail "single-bill.js has syntax errors"
    echo "$SINGLE_SYNTAX"
fi

echo "Checking multi-bill.js..."
MULTI_SYNTAX=$(ssh $SERVER "node -c $REMOTE_PATH/public/js/multi-bill.js 2>&1")

if [ -z "$MULTI_SYNTAX" ]; then
    print_check "multi-bill.js syntax OK"
else
    print_fail "multi-bill.js has syntax errors"
    echo "$MULTI_SYNTAX"
fi

# Test 8: Functional test
print_test "Test 8: Basic Functional Test"

echo "Creating test bill..."
TEST_RESPONSE=$(ssh $SERVER "curl -s -X POST http://localhost:3001/split-bill/api/bills/create \
  -H 'Content-Type: application/json' \
  -d '{\"title\":\"Verification Test\",\"mode\":\"single\",\"currency_symbol\":\"Rp\"}'")

TEST_BILL_ID=$(echo $TEST_RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TEST_BILL_ID" ]; then
    print_check "Test bill created: $TEST_BILL_ID"
    
    # Cleanup
    ssh $SERVER "cd $REMOTE_PATH && sqlite3 data/splitbill.db 'DELETE FROM bills WHERE id=\"$TEST_BILL_ID\";'" 2>/dev/null
    print_check "Test data cleaned up"
else
    print_fail "Could not create test bill"
fi

# Summary
print_test "Summary"

echo ""
echo "✅ Verification complete!"
echo ""
echo "🌐 Access your app at:"
echo "  http://152.69.214.36/split-bill/"
echo ""
echo "📋 Manual Testing Checklist:"
echo ""
echo "Issue 1: Google Vision Only"
echo "  [ ] Upload receipt and verify OCR uses Google Vision"
echo "  [ ] Check browser console - no Tesseract loading"
echo "  [ ] Verify OCR accuracy is good"
echo ""
echo "Issue 2: Receipt Save Reliability"
echo "  [ ] Process receipt with OCR"
echo "  [ ] Click 'Save Receipt' and verify success"
echo "  [ ] Check all items were added"
echo "  [ ] Try with poor quality image"
echo ""
echo "Issue 3: Tax Buttons Always Visible"
echo "  [ ] Process receipt without tax"
echo "  [ ] Verify 'Add Tax' and 'Add Service Charge' buttons visible"
echo "  [ ] Add manual tax/charge successfully"
echo ""
echo "Issue 4: Add Items to Receipt"
echo "  [ ] Configure a receipt"
echo "  [ ] Click '+ Add New Item'"
echo "  [ ] Add item and verify it appears"
echo ""
echo "Issue 5: Manual Multiple Items"
echo "  [ ] Click 'Add Manual Items'"
echo "  [ ] Add 3-4 items to the list"
echo "  [ ] Save receipt and verify all items saved"
echo ""
echo "Issue 6: Feature Parity"
echo "  [ ] Test same workflow in single-bill mode"
echo "  [ ] Test same workflow in multi-bill mode"
echo "  [ ] Verify consistent behavior"
echo ""
echo "📊 Monitor logs while testing:"
echo "  ssh $SERVER 'sudo journalctl -u split-bill -f'"
echo ""
echo "🐛 If issues found:"
echo "  1. Check browser console for JavaScript errors"
echo "  2. Check server logs for backend errors"
echo "  3. Clear browser cache and retry"
echo "  4. Verify Google Vision credentials are configured"
echo ""