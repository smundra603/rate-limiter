# Rate Limiter API Documentation

## Table of Contents

- [Authentication](#authentication)
- [Rate Limit Headers](#rate-limit-headers)
- [Endpoints](#endpoints)
- [Response Formats](#response-formats)
- [Error Handling](#error-handling)
- [Testing Examples](#testing-examples)

## Authentication

The rate limiter supports multiple authentication methods to extract tenant and user identity.

### Method 1: JWT Token (Recommended)

Include a JWT token in the Authorization header:

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:8080/api/search
```

**JWT Payload Requirements:**

```json
{
  "tenant_id": "acme_corp",  // Required
  "user_id": "alice",         // Required
  "sub": "alice",             // Alternative to user_id
  "iat": 1640000000,
  "exp": 1640086400
}
```

**Generate JWT (Node.js):**

```javascript
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    tenant_id: 'acme_corp',
    user_id: 'alice'
  },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
```

### Method 2: API Key

Include an API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: tenant_id.user_id.secret" \
  http://localhost:8080/api/search
```

**Format:** `{tenant_id}.{user_id}.{secret}`

Example: `acme_corp.alice.abc123xyz`

### Method 3: Custom Headers

Include tenant and user IDs in custom headers:

```bash
curl -H "X-Tenant-ID: acme_corp" \
     -H "X-User-ID: alice" \
  http://localhost:8080/api/search
```

### Method 4: Anonymous (Fallback)

If no authentication is provided, requests are treated as anonymous and rate-limited under the `anonymous` tenant with strict limits.

## Rate Limit Headers

### Standard Headers (Always Present)

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Limit` | Maximum requests allowed in current window | `1000` |
| `X-RateLimit-Remaining` | Requests remaining in current window | `850` |
| `X-RateLimit-Reset` | Unix timestamp when limit resets | `1640000000` |
| `X-RateLimit-Mode` | Current rate limit mode | `enforcement` |

### Conditional Headers

| Header | When Present | Description | Example |
|--------|--------------|-------------|---------|
| `X-RateLimit-Warning` | Soft throttle | Warning message about approaching limit | `Approaching rate limit (user_endpoint). 10 requests remaining.` |
| `Retry-After` | Hard throttle (429) | Seconds to wait before retry | `30` |
| `X-RateLimit-Exceeded` | Logging mode | Indicates limit was exceeded but request allowed | `true` |
| `X-RateLimit-Shadow` | Shadow mode | Would have throttled in enforcement mode | `true` |
| `X-RateLimit-Error` | Error occurred | Rate limiter error (fail-open) | `true` |

## Endpoints

### Health Check Endpoints

#### GET /health

Detailed health status of all components.

**Request:**
```bash
curl http://localhost:8080/health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "components": {
    "redis": "up",
    "mongodb": "up",
    "policy_cache": {
      "status": "up",
      "size": 150,
      "hit_ratio": 0.95
    }
  }
}
```

**Response (503 Service Unavailable):**
```json
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "components": {
    "redis": "down",
    "mongodb": "up",
    "policy_cache": {
      "status": "up",
      "size": 150,
      "hit_ratio": 0.95
    }
  }
}
```

#### GET /ready

Readiness probe for Kubernetes/container orchestration.

**Response (200 OK):**
```json
{
  "status": "ready"
}
```

**Response (503 Not Ready):**
```json
{
  "status": "not ready",
  "redis": false,
  "mongodb": true
}
```

#### GET /live

Liveness probe (always returns 200).

**Response:**
```json
{
  "status": "alive"
}
```

#### GET /metrics

Prometheus metrics in text format.

**Request:**
```bash
curl http://localhost:8080/metrics
```

**Response (text/plain):**
```
# HELP rate_limiter_requests_total Total number of rate limit checks performed
# TYPE rate_limiter_requests_total counter
rate_limiter_requests_total{tenant_id="acme_corp",endpoint="/api/search",result="allowed",state="normal",mode="enforcement"} 1500

# HELP rate_limiter_check_duration_ms Duration of rate limit checks in milliseconds
# TYPE rate_limiter_check_duration_ms histogram
rate_limiter_check_duration_ms_bucket{scope="tenant_global",le="1"} 850
rate_limiter_check_duration_ms_bucket{scope="tenant_global",le="2"} 980
...
```

### Demo API Endpoints

All demo endpoints require rate limiting and authentication.

#### GET /api/search

Search endpoint with high rate limits.

**Request:**
```bash
curl -H "X-Tenant-ID: acme_corp" \
     -H "X-User-ID: alice" \
  http://localhost:8080/api/search?q=test
```

**Response (200 OK):**
```json
{
  "message": "Search endpoint (high limit)",
  "results": []
}
```

**Headers:**
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4850
X-RateLimit-Reset: 1640000000
```

#### POST /api/upload

Upload endpoint with low rate limits (expensive operation).

**Request:**
```bash
curl -X POST \
  -H "X-Tenant-ID: acme_corp" \
  -H "X-User-ID: alice" \
  -H "Content-Type: application/json" \
  -d '{"file": "data"}' \
  http://localhost:8080/api/upload
```

**Response (200 OK):**
```json
{
  "message": "Upload endpoint (low limit - expensive operation)",
  "file_id": "demo-1640000000000"
}
```

**Headers:**
```
X-RateLimit-Limit: 50
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1640000060
```

#### GET /api/dashboard

Dashboard endpoint with medium rate limits.

**Response (200 OK):**
```json
{
  "message": "Dashboard endpoint (medium limit)",
  "data": {
    "metrics": {},
    "charts": []
  }
}
```

#### POST /api/export

Export endpoint with very low rate limits (very expensive).

**Response (200 OK):**
```json
{
  "message": "Export endpoint (very low limit - very expensive)",
  "export_id": "export-1640000000000"
}
```

**Rate Limits:**
- User: 5 requests/minute
- Tenant: 50 requests/minute total

#### GET /api/ml/inference

ML inference endpoint with global rate limits.

**Response (200 OK):**
```json
{
  "message": "ML inference endpoint (global limit)",
  "prediction": 0.87654
}
```

**Rate Limits:**
- Global endpoint limit: 5000 requests/minute (all tenants combined)

## Response Formats

### Success Response (200 OK)

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 850
X-RateLimit-Reset: 1640000060
X-RateLimit-Mode: enforcement

{
  "message": "Success",
  "data": {}
}
```

### Soft Throttle Warning (200 OK)

Request allowed but approaching limit.

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 10
X-RateLimit-Reset: 1640000060
X-RateLimit-Warning: Approaching rate limit (user_endpoint). 10 requests remaining.
X-RateLimit-Mode: enforcement

{
  "message": "Success",
  "data": {}
}
```

### Hard Throttle (429 Too Many Requests)

Request rejected due to rate limit exceeded.

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 30
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640000060
X-RateLimit-Mode: enforcement

{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for user_endpoint",
  "limit": 1000,
  "remaining": 0,
  "reset": 1640000060,
  "retry_after": 30,
  "scope": "user_endpoint"
}
```

### Shadow Mode Response (200 OK)

In shadow mode, requests are always allowed but headers indicate what would happen.

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640000060
X-RateLimit-Shadow: true
X-RateLimit-Mode: shadow

{
  "message": "Success",
  "data": {}
}
```

## Error Handling

### 400 Bad Request

Invalid request format.

```json
{
  "error": "Bad Request",
  "message": "Invalid request body"
}
```

### 404 Not Found

Endpoint does not exist.

```json
{
  "error": "Not Found",
  "message": "The requested endpoint does not exist"
}
```

### 500 Internal Server Error

Server error (fail-open: rate limiting is bypassed).

```http
HTTP/1.1 500 Internal Server Error
X-RateLimit-Error: true

{
  "error": "Internal Server Error",
  "message": "An error occurred"
}
```

### 503 Service Unavailable

Service is not ready (health check failed).

```json
{
  "status": "not ready",
  "redis": false,
  "mongodb": true
}
```

## Testing Examples

### Example 1: Basic Request

```bash
curl -v \
  -H "X-Tenant-ID: demo_tenant" \
  -H "X-User-ID: user_123" \
  http://localhost:8080/api/search
```

**Output:**
```
< HTTP/1.1 200 OK
< X-RateLimit-Limit: 600
< X-RateLimit-Remaining: 599
< X-RateLimit-Reset: 1640000060
< X-RateLimit-Mode: shadow

{"message":"Search endpoint (high limit)","results":[]}
```

### Example 2: Burst Request (Test Throttling)

```bash
# Make 100 requests rapidly
for i in {1..100}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "X-Tenant-ID: demo_tenant" \
    -H "X-User-ID: user_123" \
    http://localhost:8080/api/upload
done
```

### Example 3: JWT Authentication

```bash
# Generate token (Node.js)
TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({tenant_id:'demo_tenant',user_id:'alice'},'test-secret'))")

# Make request
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/search
```

### Example 4: Check Rate Limit Status

```bash
curl -I \
  -H "X-Tenant-ID: demo_tenant" \
  -H "X-User-ID: user_123" \
  http://localhost:8080/api/search | grep RateLimit
```

**Output:**
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 550
X-RateLimit-Reset: 1640000060
X-RateLimit-Mode: shadow
```

### Example 5: Test Different Endpoints

```bash
# High limit endpoint
curl -H "X-Tenant-ID: acme_corp" -H "X-User-ID: bob" \
  http://localhost:8080/api/search

# Low limit endpoint (upload)
curl -X POST -H "X-Tenant-ID: acme_corp" -H "X-User-ID: bob" \
  http://localhost:8080/api/upload

# Very low limit endpoint (export)
curl -X POST -H "X-Tenant-ID: acme_corp" -H "X-User-ID: bob" \
  http://localhost:8080/api/export
```

### Example 6: Test Hierarchical Limits

```bash
# Test user global limit (all endpoints)
for i in {1..150}; do
  curl -s -H "X-Tenant-ID: startup_free" -H "X-User-ID: charlie" \
    http://localhost:8080/api/search
done

# Test user-specific endpoint limit (upload only)
for i in {1..20}; do
  curl -s -X POST -H "X-Tenant-ID: startup_free" -H "X-User-ID: charlie" \
    http://localhost:8080/api/upload
done
```

## Rate Limit Calculation

### Token Bucket Algorithm

The rate limiter uses a token bucket algorithm:

1. **Bucket Capacity**: `burst_capacity` (e.g., 150 tokens)
2. **Refill Rate**: `rpm / 60` tokens per second
3. **Token Consumption**: 1 token per request
4. **Refill**: Continuous (calculated on each request)

**Example:**
- RPM: 100
- Burst capacity: 150
- Refill rate: 1.67 tokens/second

**Behavior:**
- Can burst up to 150 requests immediately
- Sustained rate: 100 requests/minute
- After burst, must wait for refill

### Threshold Calculation

- **Normal**: Usage < 100%
- **Soft Throttle**: Usage >= 100% and < 105%
- **Hard Throttle**: Usage >= 105%

**Usage Calculation:**
```
usage_pct = (tokens_consumed / capacity) * 100
```

## Best Practices

1. **Always check headers**: Monitor `X-RateLimit-Remaining` to avoid hitting limits
2. **Implement exponential backoff**: When receiving 429, use `Retry-After` header
3. **Handle warnings**: Act on `X-RateLimit-Warning` before hard throttle
4. **Use appropriate authentication**: JWT tokens are most secure
5. **Cache responses**: Reduce API calls where possible
6. **Monitor your usage**: Set up alerts for approaching limits
7. **Request limit increases**: Contact support before hitting limits regularly

## Support

For API questions or issues:
- Documentation: `/docs`
- Health status: `GET /health`
- Metrics: `GET /metrics`
