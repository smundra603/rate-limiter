# Load Tests

This directory contains k6 load tests for the rate limiter.

## Prerequisites

1. **Install k6**:
   ```bash
   # macOS
   brew install k6

   # Linux
   sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6

   # Windows
   choco install k6
   ```

2. **Start the rate limiter**:
   ```bash
   npm run docker:up
   npm run seed
   ```

3. **Verify service is running**:
   ```bash
   curl http://localhost:8080/health
   ```

## Running Load Tests

### Run All Scenarios (Recommended)

```bash
k6 run tests/load/rate-limiter.k6.js
```

This runs all three scenarios:
1. **Steady Load** (5 minutes): 100 VUs, constant load
2. **Spike Test** (2.5 minutes): 0 → 1000 VUs spike
3. **Burst Test** (2 minutes): 25 VUs, 1000 iterations

Total duration: ~11 minutes

### Run Individual Scenarios

**Steady Load Only:**
```bash
k6 run --scenarios steady_load tests/load/rate-limiter.k6.js
```

**Spike Test Only:**
```bash
k6 run --scenarios spike_test tests/load/rate-limiter.k6.js
```

**Burst Test Only:**
```bash
k6 run --scenarios burst_test tests/load/rate-limiter.k6.js
```

### Custom Configuration

**Change VUs (Virtual Users):**
```bash
k6 run --vus 200 tests/load/rate-limiter.k6.js
```

**Change Duration:**
```bash
k6 run --duration 10m tests/load/rate-limiter.k6.js
```

**Change Tenant:**
```bash
k6 run --env TENANT_ID=acme_corp tests/load/rate-limiter.k6.js
```

**Change Base URL:**
```bash
k6 run --env BASE_URL=http://production:8080 tests/load/rate-limiter.k6.js
```

## Test Scenarios

### 1. Steady Load Test
- **Goal**: Test sustained throughput
- **VUs**: 100
- **Duration**: 5 minutes
- **Pattern**: Constant load with random think time (50-500ms)
- **Validates**: Normal operation under typical load

### 2. Spike Test
- **Goal**: Test behavior under sudden traffic spikes
- **VUs**: 0 → 50 → 1000 → 50 → 0
- **Duration**: 2.5 minutes
- **Pattern**: Rapid ramp-up and ramp-down
- **Validates**: Rate limiting under stress, recovery

### 3. Burst Test
- **Goal**: Test dashboard-style burst traffic
- **VUs**: 25
- **Iterations**: 1000 (shared)
- **Duration**: Max 2 minutes
- **Pattern**: Multiple rapid parallel requests
- **Validates**: Handling of concurrent bursts

## Metrics

### Performance Metrics
- `http_req_duration`: Total request duration
  - **Target**: p95 < 10ms, p99 < 20ms
- `rate_limit_check_latency`: Rate limit check latency only
  - **Target**: p99 < 10ms
- `http_req_failed`: Request failure rate
  - **Target**: < 1%

### Rate Limiting Metrics
- `throttle_rate`: Overall throttle rate
  - **Target**: < 20%
- `soft_throttle_rate`: Soft throttle rate (warnings)
  - **Target**: < 15%
- `hard_throttle_rate`: Hard throttle rate (429s)
  - **Target**: < 5%
- `requests_allowed`: Total allowed requests
- `requests_throttled`: Total throttled requests

## Expected Results

### Performance Targets

| Metric | Target | Acceptable | Notes |
|--------|--------|------------|-------|
| Latency (P99) | < 10ms | < 20ms | Rate limit check overhead |
| Throughput | > 10,000 req/s | > 5,000 req/s | System capacity |
| Error Rate | < 0.1% | < 1% | Non-rate-limit errors |
| Throttle Rate | 10-20% | < 30% | Depends on tenant limits |

### Pass Criteria

✅ **Pass** if:
- P99 latency < 20ms
- Error rate < 1%
- Throttle rate < 30%
- No Redis connection failures
- No MongoDB connection failures

⚠️ **Warning** if:
- P99 latency 20-50ms
- Error rate 1-5%
- Throttle rate 30-50%

❌ **Fail** if:
- P99 latency > 50ms
- Error rate > 5%
- Throttle rate > 50%
- Service crashes

## Output

### Console Output

The test produces a detailed summary:

```
═══════════════════════════════════════════════
  RATE LIMITER LOAD TEST RESULTS
═══════════════════════════════════════════════

📊 SCENARIOS:
  - steady_load
  - spike_test
  - burst_test

⚡ PERFORMANCE:
  Request Duration (p95): 8.45ms
  Request Duration (p99): 12.32ms
  Rate Limit Latency (p99): 4.67ms
  Requests/sec: 12543.21

🚦 RATE LIMITING:
  Total Throttle Rate: 15.32%
  Soft Throttle Rate: 12.45%
  Hard Throttle Rate: 2.87%
  Requests Allowed: 318542
  Requests Throttled: 57623

✅ RELIABILITY:
  Success Rate: 99.95%
  Error Rate: 0.05%

═══════════════════════════════════════════════
```

### JSON Output

Results are also saved to `load-test-results.json` for further analysis:

```bash
# View results
cat load-test-results.json | jq '.metrics'

# Extract specific metrics
cat load-test-results.json | jq '.metrics.http_req_duration.values'
```

## Monitoring During Tests

While tests run, monitor:

1. **Grafana**: http://localhost:3000
   - Request rate
   - Throttle rate
   - Latency percentiles

2. **Prometheus**: http://localhost:9090
   - Query: `rate(rate_limiter_requests_total[1m])`

3. **System Resources**:
   ```bash
   docker stats
   ```

## Troubleshooting

### High Error Rate

**Symptoms**: `http_req_failed` > 5%

**Causes**:
- Service not running
- Redis connection issues
- MongoDB connection issues

**Solutions**:
```bash
# Check service health
curl http://localhost:8080/health

# Check logs
npm run docker:logs

# Restart services
npm run docker:down && npm run docker:up
```

### High Latency

**Symptoms**: P99 > 50ms

**Causes**:
- Insufficient resources
- Policy cache misses
- Slow MongoDB queries

**Solutions**:
- Increase Docker resources
- Warm policy cache before testing
- Check MongoDB indexes

### Unexpected Throttling

**Symptoms**: Throttle rate > 50%

**Causes**:
- Tenant limits too low for test load
- Using wrong tenant ID

**Solutions**:
```bash
# Use high-limit tenant
k6 run --env TENANT_ID=loadtest_tenant tests/load/rate-limiter.k6.js

# Check tenant policy
npm run seed
```

## Advanced Usage

### Custom Scenarios

Edit `rate-limiter.k6.js` to add custom scenarios:

```javascript
export const options = {
  scenarios: {
    my_custom_test: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      exec: 'myCustomFunction',
    },
  },
};

export function myCustomFunction() {
  // Your test logic
}
```

### Cloud Execution

Run tests from k6 Cloud:

```bash
k6 cloud tests/load/rate-limiter.k6.js
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Run Load Tests
  run: |
    k6 run --quiet tests/load/rate-limiter.k6.js
```

## References

- [k6 Documentation](https://k6.io/docs/)
- [k6 Examples](https://k6.io/docs/examples/)
- [k6 Best Practices](https://k6.io/docs/testing-guides/test-types/)
