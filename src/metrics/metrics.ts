import promClient from 'prom-client';
import { CircuitBreakerState, RateLimitDecision, RateLimitMode } from '../types';

// Initialize default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ prefix: 'rate_limiter_' });

// ==================== Custom Metrics ====================

/**
 * Counter: Total rate limit requests
 * Labels: tenant_id, endpoint, result (allowed/throttled_soft/throttled_hard), state, mode
 */
export const requestsTotal = new promClient.Counter({
  name: 'rate_limiter_requests_total',
  help: 'Total number of rate limit checks performed',
  labelNames: ['tenant_id', 'endpoint', 'result', 'state', 'mode'],
});

/**
 * Histogram: Rate limit check duration in milliseconds
 * Labels: scope (user_global, tenant_global, etc.)
 */
export const checkDuration = new promClient.Histogram({
  name: 'rate_limiter_check_duration_ms',
  help: 'Duration of rate limit checks in milliseconds',
  labelNames: ['scope'],
  buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500],
});

/**
 * Gauge: Current token count in buckets
 * Labels: scope, tenant_id
 */
export const bucketTokens = new promClient.Gauge({
  name: 'rate_limiter_bucket_tokens',
  help: 'Current number of tokens in rate limit bucket',
  labelNames: ['scope', 'tenant_id'],
});

/**
 * Gauge: Bucket usage percentage
 * Labels: scope, tenant_id
 */
export const bucketUsagePct = new promClient.Gauge({
  name: 'rate_limiter_bucket_usage_pct',
  help: 'Current usage percentage of rate limit bucket',
  labelNames: ['scope', 'tenant_id', 'endpoint'],
});

/**
 * Counter: Policy cache hits
 */
export const policyCacheHits = new promClient.Counter({
  name: 'rate_limiter_policy_cache_hits_total',
  help: 'Total number of policy cache hits',
});

/**
 * Counter: Policy cache misses
 */
export const policyCacheMisses = new promClient.Counter({
  name: 'rate_limiter_policy_cache_misses_total',
  help: 'Total number of policy cache misses',
});

/**
 * Gauge: Policy cache hit ratio
 */
export const policyCacheHitRatio = new promClient.Gauge({
  name: 'rate_limiter_policy_cache_hit_ratio',
  help: 'Policy cache hit ratio (0-1)',
});

/**
 * Counter: Fallback activations
 * Labels: reason
 */
export const fallbackActivations = new promClient.Counter({
  name: 'rate_limiter_fallback_activations_total',
  help: 'Total number of fallback rate limiter activations',
  labelNames: ['reason'],
});

/**
 * Gauge: Circuit breaker state
 * Labels: resource
 * Values: 0=CLOSED, 1=HALF_OPEN, 2=OPEN
 */
export const circuitBreakerState = new promClient.Gauge({
  name: 'rate_limiter_circuit_breaker_state',
  help: 'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
  labelNames: ['resource'],
});

/**
 * Counter: Circuit breaker state transitions
 * Labels: resource, from_state, to_state
 */
export const circuitBreakerTransitions = new promClient.Counter({
  name: 'rate_limiter_circuit_breaker_transitions_total',
  help: 'Total number of circuit breaker state transitions',
  labelNames: ['resource', 'from_state', 'to_state'],
});

/**
 * Histogram: Redis operation latency
 * Labels: operation
 */
export const redisLatency = new promClient.Histogram({
  name: 'rate_limiter_redis_latency_ms',
  help: 'Redis operation latency in milliseconds',
  labelNames: ['operation'],
  buckets: [1, 2, 5, 10, 20, 50, 100],
});

/**
 * Counter: MongoDB operations
 * Labels: operation, status (success/error)
 */
export const mongodbOperations = new promClient.Counter({
  name: 'rate_limiter_mongodb_operations_total',
  help: 'Total number of MongoDB operations',
  labelNames: ['operation', 'status'],
});

/**
 * Counter: Override applied to requests
 * Labels: type (penalty_multiplier/temporary_ban/custom_limit), source (auto_detector/manual_operator)
 */
export const overrideApplied = new promClient.Counter({
  name: 'rate_limiter_override_applied_total',
  help: 'Total number of overrides applied to requests',
  labelNames: ['type', 'source'],
});

/**
 * Counter: Abuse detection flags
 * Labels: tenant_id, severity (medium/high)
 */
export const abuseDetectionFlags = new promClient.Counter({
  name: 'rate_limiter_abuse_detection_flags_total',
  help: 'Total number of abuse detection flags raised',
  labelNames: ['tenant_id', 'severity'],
});

/**
 * Counter: Abuse detection job runs
 * Labels: status (success/error)
 */
export const abuseDetectionJobRuns = new promClient.Counter({
  name: 'rate_limiter_abuse_detection_job_runs_total',
  help: 'Total number of abuse detection job runs',
  labelNames: ['status'],
});

// ==================== Helper Functions ====================

/**
 * Record a rate limit check
 */
export function recordRateLimitCheck(
  tenant_id: string,
  endpoint: string,
  decision: RateLimitDecision,
  mode: RateLimitMode,
  durationMs: number
) {
  // Determine result
  let result: string;
  if (decision.allowed && decision.state === 'normal') {
    result = 'allowed';
  } else if (decision.allowed && decision.state === 'soft') {
    result = 'throttled_soft';
  } else {
    result = 'throttled_hard';
  }

  // Increment request counter
  requestsTotal.inc({
    tenant_id,
    endpoint,
    result,
    state: decision.state,
    mode,
  });

  // Record duration
  checkDuration.observe({ scope: decision.scope }, durationMs);

  // Update bucket metrics
  bucketTokens.set({ scope: decision.scope, tenant_id }, decision.remaining);

  bucketUsagePct.set(
    {
      scope: decision.scope,
      tenant_id,
      endpoint,
    },
    ((decision.limit - decision.remaining) / decision.limit) * 100
  );
}

/**
 * Record policy cache metrics
 */
export function recordPolicyCacheMetrics(hits: number, misses: number) {
  const total = hits + misses;
  const hitRatio = total > 0 ? hits / total : 0;

  policyCacheHitRatio.set(hitRatio);
}

/**
 * Record fallback activation
 */
export function recordFallbackActivation(reason: string) {
  fallbackActivations.inc({ reason });
}

/**
 * Record circuit breaker state
 */
export function recordCircuitBreakerState(resource: string, state: CircuitBreakerState) {
  const stateValue = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;

  circuitBreakerState.set({ resource }, stateValue);
}

/**
 * Record circuit breaker transition
 */
export function recordCircuitBreakerTransition(
  resource: string,
  fromState: CircuitBreakerState,
  toState: CircuitBreakerState
) {
  circuitBreakerTransitions.inc({
    resource,
    from_state: fromState,
    to_state: toState,
  });
}

/**
 * Record Redis operation latency
 */
export function recordRedisLatency(operation: string, durationMs: number) {
  redisLatency.observe({ operation }, durationMs);
}

/**
 * Record MongoDB operation
 */
export function recordMongoDBOperation(operation: string, success: boolean) {
  mongodbOperations.inc({
    operation,
    status: success ? 'success' : 'error',
  });
}

/**
 * Get all metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return promClient.register.metrics();
}

/**
 * Get metrics registry (for custom usage)
 */
export function getRegistry() {
  return promClient.register;
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics() {
  promClient.register.clear();
}

/**
 * Record override applied
 */
export function recordOverrideApplied(type: string, source: string) {
  overrideApplied.inc({ type, source });
}

/**
 * Record abuse detection flag
 */
export function recordAbuseFlag(tenant_id: string, severity: 'medium' | 'high') {
  abuseDetectionFlags.inc({ tenant_id, severity });
}

/**
 * Record abuse detection job run
 */
export function recordAbuseDetectionJobRun(status: 'success' | 'error') {
  abuseDetectionJobRuns.inc({ status });
}
