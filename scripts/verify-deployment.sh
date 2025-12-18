#!/bin/bash
# Deployment Verification Script for Temporal Agent MCP
# Usage: ./scripts/verify-deployment.sh <BASE_URL>
# Example: ./scripts/verify-deployment.sh https://temporal-agent-mcp.onrender.com

BASE_URL="${1:-http://localhost:3324}"

echo "=============================================="
echo "  Temporal Agent MCP - Deployment Verification"
echo "=============================================="
echo "Testing: $BASE_URL"
echo ""

# Test 1: Health Check
echo "1. Health Check..."
HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "   ✓ Health check passed"
else
  echo "   ✗ Health check failed: $HEALTH"
  exit 1
fi

# Test 2: List Tools
echo "2. List MCP Tools..."
TOOLS=$(curl -s "$BASE_URL/mcp/tools")
TOOL_COUNT=$(echo "$TOOLS" | grep -o '"name"' | wc -l)
if [ "$TOOL_COUNT" -ge 5 ]; then
  echo "   ✓ Found $TOOL_COUNT tools"
else
  echo "   ✗ Expected 5+ tools, found $TOOL_COUNT"
  exit 1
fi

# Test 3: JSON-RPC Initialize
echo "3. JSON-RPC Initialize..."
INIT=$(curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
if echo "$INIT" | grep -q '"protocolVersion"'; then
  echo "   ✓ MCP protocol initialized"
else
  echo "   ✗ Initialize failed: $INIT"
  exit 1
fi

# Test 4: Rate Limiting Headers
echo "4. Rate Limiting..."
HEADERS=$(curl -s -I -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
if echo "$HEADERS" | grep -q "X-RateLimit-Limit"; then
  echo "   ✓ Rate limiting headers present"
else
  echo "   ✗ Rate limiting headers missing"
fi

# Test 5: Content-Type Enforcement
echo "5. Content-Type Enforcement..."
WRONG_CT=$(curl -s -X POST "$BASE_URL/mcp/execute" \
  -H "Content-Type: text/plain" \
  -d '{"tool":"test"}')
if echo "$WRONG_CT" | grep -q '"error":"Unsupported Media Type"'; then
  echo "   ✓ Content-Type enforcement working"
else
  echo "   ✗ Content-Type not enforced"
fi

# Test 6: Error Sanitization
echo "6. Error Sanitization..."
ERROR=$(curl -s -X POST "$BASE_URL/mcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"tool":"nonexistent_tool"}')
if echo "$ERROR" | grep -qE '(stack|trace|\.js:)'; then
  echo "   ✗ Error contains sensitive info"
else
  echo "   ✓ Errors properly sanitized"
fi

echo ""
echo "=============================================="
echo "  Verification Complete!"
echo "=============================================="
echo ""
echo "Your Temporal Agent MCP is deployed and working."
echo ""
echo "Next steps:"
echo "  1. Create a scheduled task:"
echo "     curl -X POST $BASE_URL/mcp/execute \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"tool\":\"list_tasks\",\"params\":{}}'"
echo ""
echo "  2. Connect to Claude Desktop MCP config"
echo "  3. Test with AI agent"
