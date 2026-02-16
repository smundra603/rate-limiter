/**
 * Type definitions for the multi-tenant rate limiter system
 */

// ==================== Request Identity ====================

export interface RequestIdentity {
  tenant_id: string;
  user_id: string;
  endpoint: string;
  ip_address?: string;
}

// ==================== Rate Limit Policies ====================

export interface BucketPolicy {
  rpm: number;
  rps: number;
  burst_capacity: number;
  refill_rate_per_sec?: number; // Auto-calculated from RPM if not provided
}

export interface ThrottleConfig {
  /**
   * Soft threshold percentage (0-200)
   * When usage reaches this %, requests get warnings but are still allowed
   * Example: 100 means warnings start when bucket is 100% consumed
   *
   * If not provided, soft throttle is skipped (goes straight from normal to hard)
   */
  soft_threshold_pct?: number;

  /**
   * Hard threshold percentage (0-200)
   * When usage reaches this %, requests are rejected with 429
   * Must be > soft_threshold_pct (if soft is defined)
   * Example: 110 means reject when bucket is 110% consumed (allowing 10% burst)
   */
  hard_threshold_pct: number;

  /**
   * Optional artificial delay for soft throttling (future feature)
   * Not currently implemented
   */
  delay_ms?: number;
}

export interface TenantRateLimitPolicy {
  _id?: string;
  tenant_id: string;
  tier: 'free' | 'pro' | 'enterprise' | 'custom';
  policies: {
    // Global user limit (across all endpoints for any user)
    user?: BucketPolicy;

    // Global tenant limit (across all endpoints for entire tenant)
    tenant: BucketPolicy;

    // Per-user limits for specific endpoints
    user_endpoints?: {
      [endpoint: string]: BucketPolicy;
    };

    // Per-tenant limits for specific endpoints
    tenant_endpoints?: {
      [endpoint: string]: BucketPolicy;
    };

    throttle_config: ThrottleConfig;
  };
  created_at?: Date;
  updated_at?: Date;
}

export interface GlobalRateLimitPolicy {
  _id: 'global_config';
  policies: {
    // Global system-wide limit
    global: BucketPolicy;

    // Global endpoint limits (across ALL tenants)
    endpoints?: {
      [endpoint: string]: BucketPolicy;
    };
  };
  updated_at?: Date;
}

// ==================== Rate Limit Decision ====================

export type ThrottleState = 'normal' | 'soft' | 'hard';

export type RateLimitScope =
  | 'user_global'
  | 'user_endpoint'
  | 'tenant_global'
  | 'tenant_endpoint'
  | 'global_endpoint'
  | 'global_system';

export interface RateLimitCheck {
  scope: RateLimitScope;
  key: string;
  policy: BucketPolicy;
}

export interface CheckResult {
  scope: RateLimitScope;
  allowed: boolean;
  state: ThrottleState;
  tokens: number;
  usage_pct: number;
  limit: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  state: ThrottleState;
  scope: RateLimitScope; // Which check caused the decision
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  retry_after?: number; // Seconds until retry (for hard throttle)
  debug?: {
    checks_performed: Array<{
      scope: RateLimitScope;
      tokens: number;
      usage_pct: number;
    }>;
  };
}

// ==================== Token Bucket Internal State ====================

export interface TokenBucketState {
  tokens: number;
  last_refill_ms: number;
}

export interface TokenBucketResult {
  allowed: boolean;
  state: ThrottleState;
  tokens_remaining: number;
  usage_pct: number;
}

// ==================== Configuration ====================

export type RateLimitMode = 'shadow' | 'logging' | 'enforcement';

export interface RateLimiterConfig {
  mode: RateLimitMode;
  redis: {
    cluster_nodes: string[];
    password?: string;
    timeout_ms: number;
    max_retries: number;
    pool_size: number;
  };
  mongodb: {
    uri: string;
    pool_size: number;
    connect_timeout_ms: number;
  };
  policy_cache: {
    ttl_ms: number;
    max_size: number;
    refresh_interval_ms: number;
  };
  fallback: {
    rpm: number;
    burst_capacity: number;
  };
  circuit_breaker: {
    failure_threshold: number;
    timeout_ms: number;
    success_threshold: number;
  };
  logging: {
    level: string;
    format: 'json' | 'text';
  };
}

// ==================== Circuit Breaker ====================

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  last_failure_time?: number;
}

// ==================== Metrics ====================

export interface RateLimitMetrics {
  requests_total: number;
  requests_allowed: number;
  requests_throttled_soft: number;
  requests_throttled_hard: number;
  check_duration_ms: number;
  cache_hits: number;
  cache_misses: number;
  fallback_activations: number;
}

// ==================== Errors ====================

export class RateLimiterError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'RateLimiterError';
  }
}

export class RedisError extends RateLimiterError {
  constructor(message: string, details?: unknown) {
    super(message, 'REDIS_ERROR', details);
    this.name = 'RedisError';
  }
}

export class MongoDBError extends RateLimiterError {
  constructor(message: string, details?: unknown) {
    super(message, 'MONGODB_ERROR', details);
    this.name = 'MongoDBError';
  }
}

export class PolicyNotFoundError extends RateLimiterError {
  constructor(tenant_id: string) {
    super(`Policy not found for tenant: ${tenant_id}`, 'POLICY_NOT_FOUND', { tenant_id });
    this.name = 'PolicyNotFoundError';
  }
}

// ==================== Abuse Detection & Overrides ====================

export type OverrideType = 'penalty_multiplier' | 'temporary_ban' | 'custom_limit';
export type OverrideSource = 'auto_detector' | 'manual_operator';

export interface TenantOverride {
  _id?: string;
  tenant_id: string;
  user_id?: string; // Optional: user-specific override
  endpoint?: string; // Optional: endpoint-specific override

  override_type: OverrideType;

  // For penalty_multiplier: 0.5 = 50% reduction
  penalty_multiplier?: number;

  // For custom_limit: specific RPM values
  custom_rate?: number;
  custom_burst?: number;

  reason: string;
  source: OverrideSource;

  created_at: Date;
  expires_at: Date; // REQUIRED - time-bounded safety

  metadata?: {
    detection_window?: string;
    throttle_rate?: number;
    operator_id?: string;
  };
}
