#!/bin/bash

# Test script for dispute evidence endpoints
# Usage: ./test-dispute-evidence.sh

API_URL="http://localhost:3000/api/v1"
SHIPMENT_ID="SHIP-001"
MILESTONE_INDEX="0"

# Replace these with actual JWT tokens
BUYER_TOKEN="YOUR_BUYER_JWT_TOKEN"
SUPPLIER_TOKEN="YOUR_SUPPLIER_JWT_TOKEN"
ARBITER_TOKEN="YOUR_ARBITER_JWT_TOKEN"
LOGISTICS_TOKEN="YOUR_LOGISTICS_JWT_TOKEN"

echo "=========================================="
echo "Testing Dispute Evidence Endpoints"
echo "=========================================="
echo ""

echo "Prerequisites:"
echo "- Shipment ${SHIPMENT_ID} must exist"
echo "- Milestone ${MILESTONE_INDEX} must be in DISPUTED status"
echo "- IPFS must be running on localhost:5001"
echo ""

# Create a test file
echo "Creating test files..."
echo "This is a test evidence document for the dispute." > test-evidence.txt
echo "Test evidence file created: test-evidence.txt"
echo ""

echo "=========================================="
echo "Test 1: Submit Evidence as Buyer (Should Succeed)"
echo "=========================================="
curl -X POST "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -F "description=Photos showing damaged goods upon delivery. The packaging was torn and items were broken." \
  -F "file=@test-evidence.txt" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 2: Submit Evidence as Supplier (Should Succeed)"
echo "=========================================="
curl -X POST "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -H "Authorization: Bearer ${SUPPLIER_TOKEN}" \
  -F "description=Quality inspection report showing goods were in perfect condition when shipped." \
  -F "file=@test-evidence.txt" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 3: Submit Evidence as Logistics (Should Fail - 403)"
echo "=========================================="
curl -X POST "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -H "Authorization: Bearer ${LOGISTICS_TOKEN}" \
  -F "description=This should fail - logistics cannot submit evidence" \
  -F "file=@test-evidence.txt" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 4: Submit Evidence Without File (Should Succeed)"
echo "=========================================="
curl -X POST "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -H "Content-Type: multipart/form-data" \
  -F "description=Additional context without file attachment" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 5: Get All Evidence as Arbiter (Should Succeed)"
echo "=========================================="
curl "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -H "Authorization: Bearer ${ARBITER_TOKEN}" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 6: Get All Evidence as Buyer (Should Succeed)"
echo "=========================================="
curl "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 7: Get Evidence Without Auth (Should Fail - 401)"
echo "=========================================="
curl "${API_URL}/shipments/${SHIPMENT_ID}/milestones/${MILESTONE_INDEX}/dispute-evidence" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 8: Submit Evidence for Non-Disputed Milestone (Should Fail - 409)"
echo "=========================================="
# Assuming milestone 1 is not in DISPUTED status
curl -X POST "${API_URL}/shipments/${SHIPMENT_ID}/milestones/1/dispute-evidence" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -F "description=This should fail - milestone not disputed" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

echo "=========================================="
echo "Test 9: Submit Evidence for Non-Existent Milestone (Should Fail - 404)"
echo "=========================================="
curl -X POST "${API_URL}/shipments/${SHIPMENT_ID}/milestones/999/dispute-evidence" \
  -H "Authorization: Bearer ${BUYER_TOKEN}" \
  -F "description=This should fail - milestone doesn't exist" \
  -w "\nHTTP Status: %{http_code}\n" | jq -C '.'
echo ""

# Cleanup
echo "Cleaning up test files..."
rm -f test-evidence.txt
echo ""

echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Expected Results:"
echo "✅ Test 1: 201 Created - Buyer submits evidence"
echo "✅ Test 2: 201 Created - Supplier submits evidence"
echo "❌ Test 3: 403 Forbidden - Logistics cannot submit"
echo "✅ Test 4: 201 Created - Evidence without file"
echo "✅ Test 5: 200 OK - Arbiter views evidence"
echo "✅ Test 6: 200 OK - Buyer views evidence"
echo "❌ Test 7: 401 Unauthorized - No auth token"
echo "❌ Test 8: 409 Conflict - Milestone not disputed"
echo "❌ Test 9: 404 Not Found - Milestone doesn't exist"
echo ""
