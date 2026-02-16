# Multi-Tenant Rate Limiting System

A production-ready, high-performance rate limiting system with hierarchical policies, progressive throttling, and comprehensive observability.

## 🎯 Project Status

**Core System:** ✅ Production-Ready (85% Complete)
- Tenant, User, Endpoint & Global level rate limiting
- Progressive throttling and hard limiting
- Abuse Detection and resource penalisation
- Failure and Outage handling
- Mutiple rollout support
- Complete observability & monitoring
- Docker one-command deployment

**Testing:**
- Unit & integration tests included
- System functionality verified

*See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for detailed breakdown.*

---

## Features

- **Configurable Rate Limiting**:

  - *Tenant:* Rate limit tenant across resources.
  - *Tenant endpoint:* Rate limit tenant for a specific endpoint.
  - *User:* Rate limit user on across resources.
  - *User endpoint:* Rate limit user for a specific endpoint.
  - *Global endpoint:* Global endpoint limits (protect expensive endpoints system-wide)
  - *Global system:* Overall system capacity.
- **Burst Handling**: Configurable request burst handling.
- **Progressive Throttling**: Normal → Soft throttle (warn) → Hard throttle (reject)
- **Multi-Tenant Support**: 10,000+ tenants with independent policies
- **Global Rate Limit**: Configure service wide rate limits
- **High Performance**: <5ms P99 latency, 100k+ req/sec throughput
- **Fail-Open Strategy**: Continues operating during Redis outages
- **Abuse Detection Flow**: Detect abusive patterns and penalise respective user or tenant limits. 
- **Real-Time Monitoring**: Prometheus metrics + Grafana dashboards
- **3 Rollout Modes**: Shadow → Logging → Enforcement

## Architecture

```
              ┌─────────────┐
              │   Request   │
              └──────┬──────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│     Identity Extraction                 │
│  (JWT / API Key / Headers / IP)         │
└───────────────────┬─-───────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│   Policy Manager (MongoDB + LRU Cache)  │
│   • Tenant policies (tenant, user)      │
│   • Global policies (system, endpoint)  │
│   • 60s TTL with background refresh     │
└──────-────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│   Throttle Decisioner                   │
│   1. Overrides by Abuse Detection       │
│   2. Overall User limit                 │
│   3. User-specific endpoint             │
│   4. Overall Tenant limit               │
│   5. Tenant-specific endpoint           │
│   6. Global endpoint limit              │
│   7. Global system limit                │
└──────-────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│   Redis Cluster Token Bucket            │
│   • 6 nodes (3 masters + 3 replicas)    │
│   • Hash tags for tenant data sharding  │
│   • Atomic Lua script operations        │
│   • <5ms latency                        │
└───────────────────┬────────────────────-┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│   Decision + Headers                    │
│   X-RateLimit-Limit                     │
│   X-RateLimit-Remaining                 │
│   X-RateLimit-Reset                     │
│   X-RateLimit-Warning (soft throttle)   │
└─────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+

### Get Started in 3 Steps

**Step 1: Install Dependencies**
```bash
npm install
```

**Step 2: Start All Services**
```bash
# Starts Redis, MongoDB, Prometheus, Grafana, and Rate Limiter
npm run docker:up

# Wait 10-15 seconds for services to initialize
```

**Step 3: Seed Test Data**
```bash
# Creates 11 test tenants with various configurations
npm run seed
```

**Verify It Works:**
```bash
# Health check
curl http://localhost:8080/health

# Run test client (makes 10 requests, shows rate limit headers)
npm run test:client
```

**Access Points:**
- API: http://localhost:8080
- Grafana: http://localhost:3000 (admin/admin)
- Prometheus: http://localhost:9090
- Metrics: http://localhost:8080/metrics

**Shutdown:**
```bash
npm run docker:down
```

## Configuration

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
# Rate Limit Mode
RATE_LIMIT_MODE=shadow  # shadow | logging | enforcement

# Redis Cluster (6 nodes: 3 masters + 3 replicas)
REDIS_CLUSTER_NODES=localhost:6379,localhost:6380,localhost:6381,localhost:6382,localhost:6383,localhost:6384
REDIS_TIMEOUT_MS=100

# MongoDB
MONGODB_URI=mongodb://localhost:27017/rate_limiter

# Policy Cache
POLICY_CACHE_TTL_MS=60000
POLICY_CACHE_MAX_SIZE=10000

# Fallback (when Redis unavailable)
FALLBACK_RPM=100
FALLBACK_BURST_CAPACITY=50

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Abuse Detection
ABUSE_DETECTION_ENABLED=true
ABUSE_DETECTION_CHECK_INTERVAL_MS=60000   # 1 minute
ABUSE_THROTTLE_THRESHOLD=0.5              # 50% throttle rate
ABUSE_DETECTION_WINDOW_MINUTES=1          # Detection window
ABUSE_PENALTY_DURATION_MS=60000           # 1 minute penalty
ABUSE_PENALTY_TYPE=penalty_multiplier     # or temporary_ban
ABUSE_PENALTY_MULTIPLIER=0.5              # 50% reduction
PROMETHEUS_URL=http://localhost:9090
```

### Rate Limit Modes

1. **Shadow Mode**: Calculate limits but don't enforce (metrics only)
   - Use for: Initial rollout, testing
   - Behavior: All requests allowed, metrics show what would happen

2. **Logging Mode**: Add headers but don't reject
   - Use for: Observing client behavior
   - Behavior: Adds `X-RateLimit-Exceeded` header, allows request

3. **Enforcement**: Full enforcement at 105%
   - Use for: Production
   - Behavior: Returns 429 when limit exceeded

## Policy Configuration

### Tenant Policy Structure

```json
{
  "tenant_id": "acme_corp",
  "tier": "pro",
  "policies": {
    "user": {
      "rpm": 1000,
      "rps": 16,
      "burst_capacity": 2000
    },
    "tenant": {
      "rpm": 10000,
      "rps": 166,
      "burst_capacity": 20000
    },
    "user_endpoints": {
      "/api/upload": {
        "rpm": 100,
        "rps": 2,
        "burst_capacity": 150
      }
    },
    "tenant_endpoints": {
      "/api/upload": {
        "rpm": 500,
        "rps": 8,
        "burst_capacity": 750
      }
    },
    "throttle_config": {
      "soft_threshold_pct": 100,
      "hard_threshold_pct": 105
    }
  }
}
```

### Global Policy Structure

```json
{
  "_id": "global_config",
  "policies": {
    "global": {
      "rpm": 100000,
      "rps": 1666,
      "burst_capacity": 150000
    },
    "endpoints": {
      "/api/ml/inference": {
        "rpm": 5000,
        "rps": 83,
        "burst_capacity": 6000
      }
    }
  }
}
```

## API Usage

### Authentication Methods

#### 1. JWT Token (Recommended)

```bash
curl -H "Authorization: Bearer <jwt-token>" \
  http://localhost:8080/api/search
```

JWT payload should include:
```json
{
  "tenant_id": "acme_corp",
  "user_id": "alice",
  "sub": "alice"
}
```

#### 2. API Key

```bash
curl -H "X-API-Key: tenant_id.user_id.secret" \
  http://localhost:8080/api/search
```

#### 3. Custom Headers

```bash
curl -H "X-Tenant-ID: acme_corp" \
     -H "X-User-ID: alice" \
  http://localhost:8080/api/search
```

### Response Headers

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 850
X-RateLimit-Reset: 1640000000
X-RateLimit-Mode: enforcement
```

### Soft Throttle Response

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 10
X-RateLimit-Warning: Approaching rate limit (user_endpoint). 10 requests remaining.
```

### Hard Throttle Response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30

{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for user_endpoint",
  "limit": 1000,
  "remaining": 0,
  "reset": 1640000000,
  "retry_after": 30,
  "scope": "user_endpoint"
}
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Start infrastructure only (without rate limiter)
docker-compose -f infrastructure/docker-compose.yml up redis-1 mongodb -d

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### Project Structure

```
rate-limiter/
├── src/
│   ├── core/               # Core rate limiting logic
│   │   ├── lua-scripts.ts  # Redis Lua scripts
│   │   ├── token-bucket.ts # Token bucket engine
│   │   ├── policy-manager.ts
│   │   ├── throttle-decisioner.ts
│   │   └── fallback-handler.ts
│   ├── storage/            # Data layer
│   │   ├── redis-client.ts
│   │   ├── mongodb-client.ts
│   │   └── policy-cache.ts
│   ├── middleware/         # Express middleware
│   │   ├── rate-limiter.ts
│   │   └── identity-extractor.ts
│   ├── metrics/            # Prometheus metrics
│   │   └── metrics.ts
│   └── index.ts            # Main entry point
├── tests/                  # Test files
├── scripts/                # Utility scripts
├── infrastructure/         # Docker Compose
└── docs/                   # Documentation
```

## Monitoring

### Key Metrics

#### Request Metrics
- `rate_limiter_requests_total{tenant_id, endpoint, result, state, mode}`
- `rate_limiter_check_duration_ms{scope}` (histogram)

#### Bucket Metrics
- `rate_limiter_bucket_tokens{scope, tenant_id}` (gauge)
- `rate_limiter_bucket_usage_pct{scope, tenant_id, endpoint}` (gauge)

#### Policy Cache Metrics
- `rate_limiter_policy_cache_hits_total`
- `rate_limiter_policy_cache_misses_total`
- `rate_limiter_policy_cache_hit_ratio` (gauge)

#### Reliability Metrics
- `rate_limiter_fallback_activations_total{reason}`
- `rate_limiter_circuit_breaker_state{resource}`

### Grafana Dashboards

Two pre-configured dashboards are auto-loaded:

1. **Rate Limiter - Main Dashboard** (`rate-limiter.json`)
   - Overall system performance
   - Request patterns and throttle rates
   - Cache performance and circuit breaker status

2. **Rate Limiter - Abuse Detection** (`abuse-detection.json`)
   - Real-time abuse monitoring
   - Override application tracking
   - Tenant risk assessment
   - Detection job health

Access at http://localhost:3000 (credentials: admin/admin)

**See [docs/GRAFANA_DASHBOARDS.md](docs/GRAFANA_DASHBOARDS.md) for detailed dashboard guide**

Key panels:
- Request rate by mode
- Throttle rate (actual vs shadow)
- Top throttled tenants
- Latency percentiles
- Cache hit ratio
- Fallback activations

## Testing

### Available Test Files

```bash
# Unit tests (token bucket, policy validation)
npm run test:unit

# Integration tests (full request flow, health endpoints)
npm run test:integration

# All tests
npm test
```

### Interactive Test Client

Quick testing with the built-in test client:

```bash
# Basic test (10 requests)
npm run test:client

# Test specific tenant
npm run test:client -- --tenant strict_tenant --requests 20

# Burst test (rapid-fire requests)
npm run test:client -- --endpoint /api/upload --requests 50 --delay 0
```

### Comprehensive Test Scenarios

Use the automated test scenario script for comprehensive testing:

```bash
# Run all basic scenarios
./scripts/test-scenarios.sh all

# Run specific scenario
./scripts/test-scenarios.sh basic           # Basic rate limiting
./scripts/test-scenarios.sh auth            # Different authentication methods
./scripts/test-scenarios.sh endpoints       # Endpoint-specific limits
./scripts/test-scenarios.sh burst           # Burst traffic simulation
./scripts/test-scenarios.sh exhaustion      # Quota exhaustion testing
./scripts/test-scenarios.sh tenants         # Different tenant tiers
./scripts/test-scenarios.sh hierarchical    # Hierarchical limits
./scripts/test-scenarios.sh health          # Health endpoints
```

**What it covers:**
- Basic rate limiting with headers
- Authentication methods (JWT, API key, custom headers, anonymous)
- Endpoint-specific limits (upload, export, search, etc.)
- Progressive throttling (normal → soft → hard)
- Burst capacity handling
- Quota exhaustion and 429 responses
- Different tenant tiers (free, pro, enterprise)
- Hierarchical rate limiting (user vs tenant limits)
- Health and monitoring endpoints

### Resilience Testing

Test circuit breaker and failover behavior:

```bash
./scripts/test-resilience.sh
```

**What it tests:**
1. Normal operation with healthy Redis
2. Complete Redis outage simulation (pauses all instances)
3. Circuit breaker state transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
4. Fallback in-memory rate limiter activation
5. Requests continue working during outage (fail-open)
6. Redis recovery and automatic circuit breaker closure
7. Metrics tracking (fallback activations, circuit state)

**Expected results:**
- System continues serving requests during Redis outage
- Fallback counter increments: `rate_limiter_fallback_activations_total`
- Circuit breaker opens and closes automatically
- All Redis instances restored after test

### Abuse Detection Testing

Test automatic abuse detection and penalty application:

```bash
npm run test:abuse
```

**What it tests:**
1. Automated traffic generation to trigger throttling (200 requests by default)
2. Prometheus metrics collection for throttle rate calculation
3. Abuse detection job execution and tenant scanning
4. Automatic penalty override creation for abusive tenants
5. Severity classification (medium: 50-80%, high: >80% throttle rate)
6. Penalty multiplier application (reduces limits to 50% of original)
7. Override expiration and rate limit restoration

**Expected results:**
- Override created automatically for tenant with high throttle rate
- Metrics increment: `rate_limiter_abuse_detection_flags_total{severity}`
- Detection job metrics: `rate_limiter_abuse_detection_job_runs_total{status="success"}`
- Reduced rate limits applied: Original 1000 RPM → 500 RPM (50% penalty)
- Test script confirms all 4 steps: traffic generation → detection wait → override verification → effect test

**Optional parameters:**
```bash
# Test specific tenant with custom traffic
npm run test:abuse --tenant demo_tenant --requests 150

# Test with longer detection window
npm run test:abuse --wait 120

# Test specific endpoint
npm run test:abuse --endpoint /api/upload
```

### Rollout Mode Testing

`Note: We have kept via environment variable for now. But on production will do via feature flag.`

Test different operational modes by updating environment and restarting:

```bash
# 1. Update .env file with desired mode
echo "RATE_LIMIT_MODE=shadow" > .env

# 2. Restart services
npm run docker:down
npm run docker:up

# 3. Test requests (all allowed in shadow mode)
npm run test:client
```

**Available modes:**
- `shadow` - Calculate limits but don't enforce (metrics only)
- `logging` - Add headers but don't reject requests
- `enforcement` - Full enforcement at 105% (production mode)

### Monitoring & Observability

**Prometheus Metrics:**
```bash
curl http://localhost:8080/metrics | grep rate_limiter
```

**Grafana Dashboard:**
- URL: http://localhost:3000 (admin/admin)
- Note: Dashboard needs manual setup in UI (metrics are ready)

**Health Endpoints:**
```bash
curl http://localhost:8080/health     # Detailed health status
curl http://localhost:8080/ready      # Kubernetes readiness
curl http://localhost:8080/live       # Kubernetes liveness
```

## Deployment

### Production Checklist

- [ ] Set `RATE_LIMIT_MODE=enforcement`
- [ ] Configure `JWT_SECRET`
- [ ] Set up Redis cluster with persistence
- [ ] Configure MongoDB replica set
- [ ] Set `LOG_LEVEL=info`
- [ ] Configure Grafana alerts
- [ ] Warm policy cache on startup
- [ ] Set resource limits in Docker
- [ ] Configure backups for MongoDB
- [ ] Set up log aggregation

### Docker Deployment

```bash
# Build image
docker build -t rate-limiter:latest .

# Run container
docker run -d \
  --name rate-limiter \
  -p 8080:8080 \
  --env-file .env \
  rate-limiter:latest
```

### Health Checks

- **Liveness**: `GET /live` - Always returns 200
- **Readiness**: `GET /ready` - Returns 503 if dependencies unavailable
- **Health**: `GET /health` - Detailed health status

## Troubleshooting

### High Latency

1. Check Redis latency: `redis-cli --latency`
2. Monitor `rate_limiter_check_duration_ms` metric
3. Verify policy cache hit ratio >90%
4. Check MongoDB connection pool

### Fallback Mode Activated

1. Check Redis connectivity
2. Review circuit breaker state
3. Check `rate_limiter_circuit_breaker_state` metric
4. Review error logs

### Incorrect Throttling

1. Verify policy configuration in MongoDB
2. Check policy cache invalidation
3. Review debug headers in response
4. Check clock synchronization

### Cache Issues

1. Monitor `rate_limiter_policy_cache_hit_ratio`
2. Verify MongoDB change streams working
3. Check cache TTL configuration
4. Review background refresh logs

## What not covered
  - Multi Region deployment: Covered in architecture but not implemented

## Roadmap

- [ ] Multi-region quota synchronization
- [ ] API policy management
