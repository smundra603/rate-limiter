# Quick Start Guide

Get the rate limiter up and running in 5 minutes!

## Prerequisites

- Docker & Docker Compose
- Node.js 20+

## Automated Setup

Run the quickstart script:

```bash
chmod +x scripts/quickstart.sh
./scripts/quickstart.sh
```

This will:
1. ✅ Check prerequisites
2. 📝 Create .env file
3. 📦 Install dependencies
4. 🐳 Start all services (Redis, MongoDB, Prometheus, Grafana, Rate Limiter)
5. 🌱 Seed test data
6. 🎉 Confirm everything is working

## Manual Setup

If you prefer manual setup:

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Environment File

```bash
cp .env.example .env
```

### 3. Start Infrastructure

```bash
cd infrastructure
docker-compose up -d
cd ..
```

### 4. Seed Test Data

```bash
npm run seed
```

## Verify Installation

### Check Health

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "components": {
    "redis": "up",
    "mongodb": "up",
    "policy_cache": {
      "status": "up"
    }
  }
}
```

### Make a Test Request

```bash
curl -H "X-Tenant-ID: demo_tenant" \
     -H "X-User-ID: user_123" \
     http://localhost:8080/api/search
```

Expected headers:
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 599
X-RateLimit-Reset: <timestamp>
X-RateLimit-Mode: shadow
```

## Test the Rate Limiter

### Basic Test

```bash
npm run test:client
```

### Burst Test

```bash
npm run test:client -- --endpoint /api/upload --requests 50 --delay 0
```

### Different Tenant

```bash
npm run test:client -- --tenant startup_free --requests 20
```

## Access Monitoring

- **Grafana**: http://localhost:3000 (username: `admin`, password: `admin`)
- **Prometheus**: http://localhost:9090
- **Metrics**: http://localhost:8080/metrics

## Available Test Tenants

| Tenant ID | Tier | User RPM | Tenant RPM | Notes |
|-----------|------|----------|------------|-------|
| `startup_free` | Free | 100 | 1,000 | Strict limits |
| `acme_corp` | Pro | 1,000 | 10,000 | Generous limits |
| `bigcorp_enterprise` | Enterprise | 10,000 | 100,000 | Minimal restrictions |
| `demo_tenant` | Free | 120 | 1,200 | Demo/testing |
| `strict_tenant` | Free | 10 | 50 | Very strict (edge case) |
| `anonymous` | Free | 30 | 300 | Unauthenticated requests |

## Common Test Scenarios

### 1. Test User Global Limit

User can make max 100 RPM across all endpoints:

```bash
# Make 150 rapid requests to different endpoints
npm run test:client -- --tenant startup_free --user alice --requests 150 --delay 0
```

### 2. Test User-Endpoint Limit

User can make max 10 uploads/min:

```bash
# Make 20 upload requests
npm run test:client -- --tenant startup_free --user bob --endpoint /api/upload --requests 20
```

**Note:** `/api/upload` is a POST endpoint. The test client auto-detects this and uses POST.

### 3. Test Tenant Limit

All users in tenant can make max 1000 RPM total:

```bash
# Simulate multiple users (run in parallel)
# Each user: 100 requests (safely within 150 user burst)
# Total: 300 requests (safely within 1500 tenant burst)
npm run test:client -- --tenant startup_free --user user1 --requests 100 --delay 0 &
npm run test:client -- --tenant startup_free --user user2 --requests 100 --delay 0 &
npm run test:client -- --tenant startup_free --user user3 --requests 100 --delay 0 &
wait
```

**Expected:** All 300 requests succeed across all 3 users

**Limits:** Each user: 100 RPM (150 burst), Tenant: 1000 RPM (1500 burst)

### 4. Test Soft Throttle

Watch for `X-RateLimit-Warning` header:

```bash
# Make rapid requests to trigger soft throttle
# demo_tenant has 180 burst capacity; requests 181-189 trigger warnings
npm run test:client -- --tenant demo_tenant --requests 185 --delay 0
```

### 5. Test Hard Throttle (429)

Exceed limit to get rejected:

```bash
# Make requests to exceed the strict limit (10 RPM user global, 15 burst)
npm run test:client -- --tenant strict_tenant --user test123 --endpoint /api/export --requests 20 --delay 0
```

**Expected:** Requests 1-15 succeed (burst capacity), requests 16+ get **429 Too Many Requests**

## Rate Limit Modes

Change mode in `.env` file:

```bash
# Shadow mode (default) - calculate but don't enforce
RATE_LIMIT_MODE=shadow

# Logging mode - add headers but don't reject
RATE_LIMIT_MODE=logging

# Full enforcement - reject at hard throttle limit
RATE_LIMIT_MODE=enforcement
```

Restart service after changing mode:

```bash
cd infrastructure
docker-compose restart rate-limiter
cd ..
```

## Troubleshooting

### Services not starting

```bash
# Check logs
npm run docker:logs

# Check individual service
docker logs rate-limiter-redis-1
docker logs rate-limiter-mongodb
docker logs rate-limiter-service
```

### Port already in use

Edit `infrastructure/docker-compose.yml` to use different ports:

```yaml
ports:
  - "8081:8080"  # Change 8080 to 8081
```

### MongoDB not seeding

Check MongoDB is ready:

```bash
docker exec -it rate-limiter-mongodb mongosh --eval "db.adminCommand('ping')"
```

Then retry seed:

```bash
npm run seed
```

### Can't access Grafana

1. Ensure Grafana is running: `docker ps | grep grafana`
2. Check logs: `docker logs rate-limiter-grafana`
3. Try accessing: http://localhost:3000

## Next Steps

1. 📖 Read the full [README.md](README.md)
2. 📚 Check [API Documentation](docs/API.md)
3. 🎨 Import Grafana dashboard
4. 🔧 Customize policies in MongoDB
5. 🚀 Deploy to production

## Stop Services

```bash
npm run docker:down
```

This stops and removes all containers but preserves data volumes.

## Clean Everything

To remove all data and start fresh:

```bash
cd infrastructure
docker-compose down -v
cd ..
```

**Warning**: This deletes all Redis data, MongoDB data, and metrics.