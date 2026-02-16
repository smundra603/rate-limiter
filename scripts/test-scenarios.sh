#!/bin/bash

# Rate Limiter Test Scenarios - Curl Commands
# Usage: ./scripts/test-scenarios.sh [scenario]
# Example: ./scripts/test-scenarios.sh basic
#          ./scripts/test-scenarios.sh all

BASE_URL="${BASE_URL:-http://localhost:8080}"
VERBOSE="${VERBOSE:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function to print colored output
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Helper function to make curl request and show rate limit headers
curl_test() {
    local description="$1"
    local url="$2"
    local method="${3:-GET}"
    local headers="$4"
    local data="$5"

    echo -e "\n${YELLOW}Test: ${description}${NC}"
    echo -e "${BLUE}Command:${NC}"

    # Build the curl command
    if [ "$method" = "POST" ]; then
        if [ -n "$data" ]; then
            echo "curl -X POST $url $headers -d '$data'"
            response=$(curl -s -i -X POST "$url" $headers -H "Content-Type: application/json" -d "$data" 2>&1)
        else
            echo "curl -X POST $url $headers"
            response=$(curl -s -i -X POST "$url" $headers 2>&1)
        fi
    else
        echo "curl $url $headers"
        response=$(curl -s -i "$url" $headers 2>&1)
    fi

    # Extract status code from HTTP response
    status_code=$(echo "$response" | grep "^HTTP" | tail -1 | awk '{print $2}')

    # Extract headers
    limit=$(echo "$response" | grep -i "^x-ratelimit-limit:" | awk '{print $2}' | tr -d '\r')
    remaining=$(echo "$response" | grep -i "^x-ratelimit-remaining:" | awk '{print $2}' | tr -d '\r')
    reset=$(echo "$response" | grep -i "^x-ratelimit-reset:" | awk '{print $2}' | tr -d '\r')
    mode=$(echo "$response" | grep -i "^x-ratelimit-mode:" | awk '{print $2}' | tr -d '\r')
    warning=$(echo "$response" | grep -i "^x-ratelimit-warning:" | awk '{print $2}' | tr -d '\r')

    echo -e "\n${GREEN}Response:${NC}"
    echo "Status: $status_code"
    echo "Rate Limit: $remaining / $limit"
    echo "Reset: $reset"
    echo "Mode: $mode"
    [ -n "$warning" ] && echo -e "${RED}Warning: $warning${NC}"

    # Show body if verbose
    if [ "$VERBOSE" = "true" ]; then
        echo -e "\n${BLUE}Body:${NC}"
        echo "$response" | sed -n '/^$/,$p' | tail -n +2 | head -20
    fi
}

# Test scenarios
test_basic() {
    print_header "SCENARIO 1: Basic Rate Limit Testing"

    print_info "Testing with custom headers (tenant + user)"
    curl_test "Request #1 - Should succeed" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: demo_tenant' -H 'X-User-ID: user_123'"

    sleep 1

    curl_test "Request #2 - Check remaining count decreases" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: demo_tenant' -H 'X-User-ID: user_123'"
}

test_authentication() {
    print_header "SCENARIO 2: Different Authentication Methods"

    print_info "Method 1: Custom Headers"
    curl_test "Using X-Tenant-ID and X-User-ID headers" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: alice'"

    sleep 1

    print_info "Method 2: API Key"
    curl_test "Using X-API-Key header (format: tenant.user.secret)" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-API-Key: acme_corp.bob.secret_key_123'"

    sleep 1

    print_info "Method 3: Anonymous (no auth headers)"
    curl_test "No authentication headers - falls back to anonymous" \
        "$BASE_URL/api/search" \
        "GET" \
        ""
}

test_endpoints() {
    print_header "SCENARIO 3: Different Endpoints with Different Limits"

    print_info "Testing various endpoints (using acme_corp tenant)"
    print_info "User global: 1000 RPM, /api/upload: 100 RPM, /api/export: 50 RPM"

    curl_test "GET /api/search - Uses global user limit (1000 RPM)" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: endpoint_user'"

    sleep 0.5

    curl_test "POST /api/upload - Endpoint-specific limit (100 RPM)" \
        "$BASE_URL/api/upload" \
        "POST" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: endpoint_user'" \
        '{"file": "test.txt", "size": 1024}'

    sleep 0.5

    curl_test "GET /api/dashboard - Uses global user limit (1000 RPM)" \
        "$BASE_URL/api/dashboard" \
        "GET" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: endpoint_user'"

    sleep 0.5

    curl_test "POST /api/export - Endpoint-specific limit (50 RPM)" \
        "$BASE_URL/api/export" \
        "POST" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: endpoint_user'" \
        '{"format": "csv"}'

    sleep 0.5

    curl_test "GET /api/ml/inference - Uses global user limit (1000 RPM)" \
        "$BASE_URL/api/ml/inference" \
        "GET" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: endpoint_user'"
}

test_burst() {
    print_header "SCENARIO 4: Burst Traffic (Rapid Requests)"

    print_info "Sending 10 rapid requests to test burst capacity"
    print_info "Using demo_tenant (120 RPM user, burst capacity: 180)"

    for i in {1..10}; do
        echo -e "\n${YELLOW}Request #$i${NC}"
        response=$(curl -s -i "$BASE_URL/api/search" \
            -H "X-Tenant-ID: demo_tenant" \
            -H "X-User-ID: burst_user_$(date +%s)")

        status=$(echo "$response" | grep "^HTTP" | awk '{print $2}')
        remaining=$(echo "$response" | grep -i "^x-ratelimit-remaining:" | awk '{print $2}' | tr -d '\r')
        limit=$(echo "$response" | grep -i "^x-ratelimit-limit:" | awk '{print $2}' | tr -d '\r')

        echo "Status: $status, Remaining: $remaining / $limit"
        sleep 0.1
    done
}

test_quota_exhaustion() {
    print_header "SCENARIO 5: Quota Exhaustion (Approaching Limit)"

    print_info "Using strict_tenant with low limits (10 RPM user, 50 RPM tenant)"
    print_info "User burst capacity: 15 tokens, Soft threshold: 100%, Hard threshold: 105%"

    for i in {1..18}; do
        echo -e "\n${YELLOW}Request #$i of 18${NC}"
        response=$(curl -s -i "$BASE_URL/api/search" \
            -H "X-Tenant-ID: strict_tenant" \
            -H "X-User-ID: quota_user")

        limit=$(echo "$response" | grep -i "x-ratelimit-limit:" | awk '{print $2}' | tr -d '\r')
        remaining=$(echo "$response" | grep -i "x-ratelimit-remaining:" | awk '{print $2}' | tr -d '\r')
        warning=$(echo "$response" | grep -i "x-ratelimit-warning:" | awk '{print $2}' | tr -d '\r')

        echo "Remaining: $remaining / $limit"

        if [ -n "$warning" ]; then
            echo -e "${RED}⚠ Warning: $warning${NC}"
        fi

        if [ "$remaining" = "0" ]; then
            echo -e "${RED}❌ Quota exhausted!${NC}"
        fi

        sleep 0.2
    done
}

test_different_tenants() {
    print_header "SCENARIO 6: Different Tenant Tiers"

    print_info "Free Tier Tenant (strict_tenant - 10 RPM user)"
    curl_test "Free tier request" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: strict_tenant' -H 'X-User-ID: free_user'"

    sleep 1

    print_info "Pro Tier Tenant (test_tenant_2 - 500 RPM user)"
    curl_test "Pro tier request" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: test_tenant_2' -H 'X-User-ID: pro_user'"

    sleep 1

    print_info "Enterprise Tier Tenant (demo_tenant - High limits)"
    curl_test "Enterprise tier request" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: demo_tenant' -H 'X-User-ID: enterprise_user'"
}

test_health_endpoints() {
    print_header "SCENARIO 7: Health & Monitoring Endpoints (No Rate Limiting)"

    print_info "These endpoints bypass rate limiting"

    curl_test "Health check" \
        "$BASE_URL/health" \
        "GET" \
        ""

    curl_test "Readiness check" \
        "$BASE_URL/ready" \
        "GET" \
        ""

    curl_test "Liveness check" \
        "$BASE_URL/live" \
        "GET" \
        ""

    print_info "Metrics endpoint (Prometheus format)"
    echo -e "\n${YELLOW}Command:${NC}"
    echo "curl $BASE_URL/metrics | head -20"
    echo -e "\n${GREEN}Response (first 20 lines):${NC}"
    curl -s "$BASE_URL/metrics" | head -20
}

test_hierarchical_limits() {
    print_header "SCENARIO 8: Hierarchical Rate Limiting"

    print_info "Testing user-level vs tenant-level limits (acme_corp tenant)"

    echo -e "\n${YELLOW}User 1 - Making requests${NC}"
    for i in {1..3}; do
        curl -s -i "$BASE_URL/api/search" \
            -H "X-Tenant-ID: acme_corp" \
            -H "X-User-ID: hierarchical_user1" | \
            grep -i "^x-ratelimit-remaining:" | \
            awk '{print "User 1 Request '$i': " $2 " remaining"}'
        sleep 0.2
    done

    echo -e "\n${YELLOW}User 2 - Same tenant, different user${NC}"
    for i in {1..3}; do
        curl -s -i "$BASE_URL/api/search" \
            -H "X-Tenant-ID: acme_corp" \
            -H "X-User-ID: hierarchical_user2" | \
            grep -i "^x-ratelimit-remaining:" | \
            awk '{print "User 2 Request '$i': " $2 " remaining"}'
        sleep 0.2
    done

    print_info "Notice: Each user has their own quota within the tenant limit"
}

test_shadow_mode() {
    print_header "SCENARIO 9: Shadow Mode Testing"

    print_info "In shadow mode, requests are allowed even when throttled"
    print_info "Check logs to see what would have been throttled"

    curl_test "Request in shadow mode" \
        "$BASE_URL/api/search" \
        "GET" \
        "-H 'X-Tenant-ID: strict_tenant' -H 'X-User-ID: shadow_user'"

    print_info "Check Docker logs: docker-compose -f infrastructure/docker-compose.yml logs rate-limiter | grep shadow"
}

test_error_handling() {
    print_header "SCENARIO 10: Error Handling"

    print_info "Testing non-existent endpoint"
    curl_test "404 - Not Found" \
        "$BASE_URL/api/nonexistent" \
        "GET" \
        "-H 'X-Tenant-ID: acme_corp' -H 'X-User-ID: error_user'"
}

# Main menu
show_menu() {
    echo -e "\n${BLUE}Rate Limiter Test Scenarios${NC}"
    echo "=============================="
    echo "1. Basic Rate Limiting"
    echo "2. Authentication Methods"
    echo "3. Different Endpoints"
    echo "4. Burst Traffic"
    echo "5. Quota Exhaustion"
    echo "6. Different Tenant Tiers"
    echo "7. Health Endpoints"
    echo "8. Hierarchical Limits"
    echo "9. Shadow Mode"
    echo "10. Error Handling"
    echo "all. Run all scenarios"
    echo ""
}

# Parse arguments
case "${1:-menu}" in
    1|basic)
        test_basic
        ;;
    2|auth|authentication)
        test_authentication
        ;;
    3|endpoints)
        test_endpoints
        ;;
    4|burst)
        test_burst
        ;;
    5|exhaustion|quota)
        test_quota_exhaustion
        ;;
    6|tenants|tiers)
        test_different_tenants
        ;;
    7|health)
        test_health_endpoints
        ;;
    8|hierarchical)
        test_hierarchical_limits
        ;;
    9|shadow)
        test_shadow_mode
        ;;
    10|error)
        test_error_handling
        ;;
    all)
        test_basic
        test_authentication
        test_endpoints
        test_health_endpoints
        test_hierarchical_limits
        test_different_tenants
        echo -e "\n${GREEN}All basic scenarios completed!${NC}"
        echo -e "${YELLOW}For advanced scenarios, run:${NC}"
        echo "  ./scripts/test-scenarios.sh burst"
        echo "  ./scripts/test-scenarios.sh exhaustion"
        echo "  ./scripts/test-scenarios.sh shadow"
        ;;
    menu|*)
        show_menu
        echo "Usage: $0 [scenario]"
        echo "Example: $0 basic"
        echo "         $0 all"
        echo "         VERBOSE=true $0 basic"
        ;;
esac
