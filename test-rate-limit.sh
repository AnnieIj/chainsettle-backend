#!/bin/bash

# Test script for rate limiting on auth endpoints
# Usage: ./test-rate-limit.sh

API_URL="http://localhost:3000/api/v1"
TEST_ADDRESS="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

echo "=========================================="
echo "Testing Rate Limiting on Auth Endpoints"
echo "=========================================="
echo ""

echo "1. Testing GET /auth/nonce (limit: 5 per minute)"
echo "--------------------------------------------------"
for i in {1..7}; do
  echo "Request $i:"
  curl -s -w "\nHTTP Status: %{http_code}\n" \
    "${API_URL}/auth/nonce?address=${TEST_ADDRESS}" | jq -C '.'
  echo ""
  sleep 1
done

echo ""
echo "2. Testing POST /auth/login (limit: 10 per minute)"
echo "---------------------------------------------------"
for i in {1..12}; do
  echo "Request $i:"
  curl -s -w "\nHTTP Status: %{http_code}\n" \
    -X POST "${API_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"stellarAddress\":\"${TEST_ADDRESS}\",\"signature\":\"test\",\"signedNonce\":\"test\"}" | jq -C '.'
  echo ""
  sleep 1
done

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Expected behavior:"
echo "- Nonce endpoint: First 5 requests succeed, 6th and 7th return 429"
echo "- Login endpoint: First 10 requests fail with 401 (invalid signature),"
echo "  11th and 12th return 429 (rate limited)"
echo ""
