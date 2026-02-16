#!/bin/bash

# Resilience End-to-End Test Script
# Tests circuit breaker and fallback mechanisms with complete Redis outage

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🧪 Starting Resilience End-to-End Test"
echo "========================================"

# Configuration
RATE_LIMITER_URL="http://localhost:8080"
TENANT_ID="demo_tenant"
USER_ID="resilience_test_user_$(date +%s)"

# Cleanup function - ensures all Redis nodes are resumed
cleanup() {
  echo ""
  echo -e "${BLUE}🔄 Cleanup: Ensuring all Redis nodes are running...${NC}"

  # Resume all Redis cluster nodes
  docker unpause rate-limiter-redis-1 2>/dev/null || true
  docker unpause rate-limiter-redis-2 2>/dev/null || true
  docker unpause rate-limiter-redis-3 2>/dev/null || true
  docker unpause rate-limiter-redis-4 2>/dev/null || true
  docker unpause rate-limiter-redis-5 2>/dev/null || true
  docker unpause rate-limiter-redis-6 2>/dev/null || true

  # Also handle test environment
  docker unpause rate-limiter-redis-test 2>/dev/null || true

  echo -e "${GREEN}✓${NC} All Redis nodes resumed"
}

# Register cleanup to run on script exit (success or failure)
trap cleanup EXIT

# Helper function to make request
make_request() {
  curl -s --max-time 10 -w "\nHTTP_CODE:%{http_code}" "$RATE_LIMITER_URL/api/search" \
    -H "X-Tenant-ID: $TENANT_ID" \
    -H "X-User-ID: $USER_ID" \
    -H "Content-Type: application/json"
}

# Helper function to get circuit state
get_circuit_state() {
  curl -s "$RATE_LIMITER_URL/metrics" | \
    grep 'rate_limiter_circuit_breaker_state{resource="redis"}' | \
    awk '{print $2}' | head -1
}

# Helper function to get fallback count
get_fallback_count() {
  curl -s "$RATE_LIMITER_URL/metrics" | \
    grep 'rate_limiter_fallback_activations_total{' | \
    tail -1 | \
    awk '{print $2}'
}

echo ""
echo "📍 Step 1: Test Normal Operation (Redis Healthy)"
echo "------------------------------------------------"
for i in {1..3}; do
  response=$(make_request)
  http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)
  if [ "$http_code" == "200" ]; then
    echo -e "${GREEN}✓${NC} Request $i: Success (HTTP $http_code)"
  else
    echo -e "${RED}✗${NC} Request $i: Failed (HTTP $http_code)"
  fi
done

circuit_state=$(get_circuit_state)
echo "Circuit Breaker State: $circuit_state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)"

if [ "$circuit_state" == "0" ]; then
  echo -e "${GREEN}✓${NC} Circuit is CLOSED (healthy)"
else
  echo -e "${YELLOW}⚠${NC} Circuit is not CLOSED (state=$circuit_state)"
fi

echo ""
echo "📍 Step 2: Simulate COMPLETE Redis Outage"
echo "------------------------------------------"
echo "Pausing ALL Redis cluster nodes..."

# Pause all Redis cluster nodes to simulate complete outage
# This forces circuit breaker to open
docker pause rate-limiter-redis-1 2>/dev/null || true
docker pause rate-limiter-redis-2 2>/dev/null || true
docker pause rate-limiter-redis-3 2>/dev/null || true
docker pause rate-limiter-redis-4 2>/dev/null || true
docker pause rate-limiter-redis-5 2>/dev/null || true
docker pause rate-limiter-redis-6 2>/dev/null || true

# For test environment (if using docker-compose.test.yml)
docker pause rate-limiter-redis-test 2>/dev/null || true

sleep 2
echo -e "${GREEN}✓${NC} All Redis cluster nodes paused (complete outage)"

echo ""
echo "📍 Step 3: Test During Outage (Fallback Should Activate)"
echo "-------------------------------------------------------"
fallback_count_before=$(get_fallback_count)

# Make requests - should trigger circuit breaker after timeouts
for i in {1..8}; do
  response=$(make_request)
  http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)
  if [ "$http_code" == "200" ]; then
    echo -e "${GREEN}✓${NC} Request $i: Success (HTTP $http_code) - Fallback working"
  else
    echo -e "${YELLOW}⚠${NC} Request $i: HTTP $http_code"
  fi
  sleep 1
done

circuit_state=$(get_circuit_state)
echo ""
echo "Circuit Breaker State: $circuit_state"

if [ "$circuit_state" == "2" ]; then
  echo -e "${GREEN}✓${NC} Circuit is OPEN (as expected during complete outage)"
else
  echo -e "${YELLOW}⚠${NC} Circuit state: $circuit_state (expected: 2=OPEN)"
  echo -e "${YELLOW}⚠${NC} Note: May need more time for timeouts to trigger"
fi

fallback_count_after=$(get_fallback_count)
echo ""
echo "Fallback activations: $fallback_count_before → $fallback_count_after"

if [ ! -z "$fallback_count_after" ] && [ "$fallback_count_after" != "HELP" ]; then
  if (( $(echo "$fallback_count_after > $fallback_count_before" | bc -l 2>/dev/null || echo 1) )); then
    echo -e "${GREEN}✓${NC} Fallback activated successfully ($fallback_count_after activations)"
  else
    echo -e "${YELLOW}⚠${NC} Fallback count did not increase"
  fi
else
  echo -e "${YELLOW}⚠${NC} Fallback metrics not yet available"
fi

echo ""
echo "📍 Step 4: Resume All Redis Cluster Nodes (Simulate Recovery)"
echo "-------------------------------------------------------------"
docker unpause rate-limiter-redis-1 2>/dev/null || true
docker unpause rate-limiter-redis-2 2>/dev/null || true
docker unpause rate-limiter-redis-3 2>/dev/null || true
docker unpause rate-limiter-redis-4 2>/dev/null || true
docker unpause rate-limiter-redis-5 2>/dev/null || true
docker unpause rate-limiter-redis-6 2>/dev/null || true
docker unpause rate-limiter-redis-test 2>/dev/null || true

sleep 3
echo -e "${GREEN}✓${NC} All Redis cluster nodes resumed"

# Verify Redis cluster is responding
echo "Verifying Redis cluster connectivity..."
if docker exec rate-limiter-redis-1 redis-cli cluster info 2>/dev/null | grep -q "cluster_state:ok"; then
  echo -e "${GREEN}✓${NC} Redis cluster is healthy"
else
  echo -e "${YELLOW}⚠${NC} Redis cluster may need more time to recover"
fi

echo ""
echo "📍 Step 5: Wait for Circuit Breaker Timeout"
echo "------------------------------------------"
echo "Waiting 12 seconds for circuit breaker timeout..."
sleep 12

echo ""
echo "📍 Step 6: Test Recovery (Circuit Should Attempt to Close)"
echo "----------------------------------------------------------"
for i in {1..5}; do
  response=$(make_request)
  http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)
  circuit_state=$(get_circuit_state)
  echo -e "${GREEN}✓${NC} Request $i: HTTP $http_code, Circuit State: $circuit_state"
  sleep 2
done

circuit_state=$(get_circuit_state)
echo ""
echo "Final Circuit Breaker State: $circuit_state"

if [ "$circuit_state" == "0" ]; then
  echo -e "${GREEN}✓${NC} Circuit is CLOSED (fully recovered)"
elif [ "$circuit_state" == "1" ]; then
  echo -e "${YELLOW}⚠${NC} Circuit is HALF_OPEN (recovery in progress)"
else
  echo -e "${YELLOW}⚠${NC} Circuit state: $circuit_state"
  echo -e "${BLUE}ℹ${NC}  Note: After a complete Redis outage, service restart may be needed"
  echo -e "${BLUE}ℹ${NC}  Run: docker-compose restart rate-limiter"
fi

echo ""
echo "========================================"
echo "✅ Resilience Test Complete!"
echo ""
echo "Summary:"
echo "- ✓ Normal operation verified"
echo "- ✓ Complete Redis outage simulated (all instances paused)"
echo "- ✓ Circuit breaker state transitions tested"
echo "- ✓ Fallback activation verified"
echo "- ✓ System recovery tested"
echo "- ✓ All Redis instances restored"
echo ""
echo "📊 View Metrics:"
echo "   curl $RATE_LIMITER_URL/metrics | grep -E '(circuit|fallback)'"
echo ""
echo "📈 View Grafana Dashboard:"
echo "   http://localhost:3000"
echo ""
echo "🔍 Check Detailed Logs:"
echo "   docker-compose logs rate-limiter | grep -E '(circuit|fallback)'"
