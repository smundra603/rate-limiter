import {
  BucketPolicy,
  CheckResult,
  RateLimitCheck,
  RateLimitDecision,
  RateLimitMode,
  RequestIdentity,
  ThrottleState,
} from '../types';
import { recordOverrideApplied } from '../metrics/metrics';
import { createCircuitBreaker } from '../utils/circuit-breaker';
import logger from '../utils/logger';
import { executeWithFallback, getFallbackHandler } from './fallback-handler';
import { getOverrideManager } from './override-manager';
import { getPolicyManager } from './policy-manager';
import { getTokenBucketEngine } from './token-bucket';

export class ThrottleDecisioner {
  private policyManager = getPolicyManager();
  private tokenBucket = getTokenBucketEngine();
  private fallbackHandler = getFallbackHandler();
  private redisCircuitBreaker = createCircuitBreaker('redis');
  private overrideManager = getOverrideManager();

  /**
   * Main entry point: Check rate limits with 6-level hierarchy
   */
  async checkRateLimit(
    identity: RequestIdentity,
    mode: RateLimitMode = 'shadow'
  ): Promise<RateLimitDecision> {
    const startTime = Date.now();

    try {
      // Execute with circuit breaker and fallback
      return await executeWithFallback(
        () => this.redisCircuitBreaker.execute(() => this.performHierarchicalCheck(identity, mode)),
        () => {
          // Fallback to in-memory rate limiting
          return this.fallbackHandler.checkRateLimit(identity, mode);
        },
        'Redis unavailable or circuit breaker open'
      );
    } finally {
      const latency = Date.now() - startTime;
      logger.debug('Rate limit check completed', {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        endpoint: identity.endpoint,
        latency_ms: latency,
      });
    }
  }

  /**
   * Perform hierarchical rate limit checks
   */
  private async performHierarchicalCheck(
    identity: RequestIdentity,
    _mode: string
  ): Promise<RateLimitDecision> {
    // 1. Load policies
    let tenantPolicy = await this.policyManager.loadPolicy(identity.tenant_id);
    const globalPolicy = await this.policyManager.getGlobalPolicy();

    // 2. Check for active overrides BEFORE building check list
    const override = await this.overrideManager.getActiveOverride(
      identity.tenant_id,
      identity.user_id,
      identity.endpoint
    );

    if (override) {
      logger.info('Override active for request', {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        endpoint: identity.endpoint,
        override_type: override.override_type,
        source: override.source,
        reason: override.reason,
      });

      // Apply override to policies
      const result = this.overrideManager.applyOverride(
        override,
        tenantPolicy.policies.tenant,
        tenantPolicy.policies.user
      );

      // If temporary ban, return immediate rejection
      if (result.banned) {
        const retryAfter = Math.ceil((override.expires_at.getTime() - Date.now()) / 1000);

        logger.warn('Request blocked by temporary ban', {
          tenant_id: identity.tenant_id,
          user_id: identity.user_id,
          endpoint: identity.endpoint,
          reason: override.reason,
          retry_after: retryAfter,
        });

        // Record override metric
        recordOverrideApplied(override.override_type, override.source);

        return {
          allowed: false,
          state: 'hard',
          scope: 'tenant_global',
          limit: 0,
          remaining: 0,
          reset: Math.ceil(override.expires_at.getTime() / 1000),
          retry_after: retryAfter,
        };
      }

      // Apply penalty multiplier or custom limit
      if (result.tenantPolicy) {
        tenantPolicy = {
          ...tenantPolicy,
          policies: {
            ...tenantPolicy.policies,
            tenant: result.tenantPolicy,
            user: result.userPolicy || tenantPolicy.policies.user,
          },
        };

        // Record override metric
        recordOverrideApplied(override.override_type, override.source);
      }
    }

    // 3. Build check list based on configured policies
    const checks: Array<RateLimitCheck & { softPct: number; hardPct: number }> = [];

    const throttleConfig = tenantPolicy.policies.throttle_config;
    const hard_threshold_pct = throttleConfig.hard_threshold_pct;

    // If soft_threshold not configured, use hard threshold (skip soft throttle)
    // This ensures: normal (0 to hard) → hard throttle (at hard)
    const soft_threshold_pct = throttleConfig.soft_threshold_pct ?? hard_threshold_pct;

    // Check 1: User global (if configured)
    if (tenantPolicy.policies.user) {
      checks.push({
        scope: 'user_global',
        key: `{tenant:${identity.tenant_id}}:user:${identity.user_id}:bucket`,
        policy: tenantPolicy.policies.user,
        softPct: soft_threshold_pct,
        hardPct: hard_threshold_pct,
      });
    }

    // Check 2: User-specific endpoint (if configured for this endpoint)
    if (tenantPolicy.policies.user_endpoints) {
      const userEndpointPolicy = this.getEndpointPolicy(
        tenantPolicy.policies.user_endpoints,
        identity.endpoint
      );

      if (userEndpointPolicy) {
        checks.push({
          scope: 'user_endpoint',
          key: `{tenant:${identity.tenant_id}}:user:${identity.user_id}:endpoint:${this.normalizeEndpoint(identity.endpoint)}:bucket`,
          policy: userEndpointPolicy,
          softPct: soft_threshold_pct,
          hardPct: hard_threshold_pct,
        });
      }
    }

    // Check 3: Tenant global (always present)
    checks.push({
      scope: 'tenant_global',
      key: `{tenant:${identity.tenant_id}}:bucket`,
      policy: tenantPolicy.policies.tenant,
      softPct: soft_threshold_pct,
      hardPct: hard_threshold_pct,
    });

    // Check 4: Tenant-specific endpoint (if configured for this endpoint)
    if (tenantPolicy.policies.tenant_endpoints) {
      const tenantEndpointPolicy = this.getEndpointPolicy(
        tenantPolicy.policies.tenant_endpoints,
        identity.endpoint
      );

      if (tenantEndpointPolicy) {
        checks.push({
          scope: 'tenant_endpoint',
          key: `{tenant:${identity.tenant_id}}:endpoint:${this.normalizeEndpoint(identity.endpoint)}:bucket`,
          policy: tenantEndpointPolicy,
          softPct: soft_threshold_pct,
          hardPct: hard_threshold_pct,
        });
      }
    }

    // Check 5: Global endpoint (if configured for this endpoint)
    if (globalPolicy.policies.endpoints) {
      const globalEndpointPolicy = this.getEndpointPolicy(
        globalPolicy.policies.endpoints,
        identity.endpoint
      );

      if (globalEndpointPolicy) {
        checks.push({
          scope: 'global_endpoint',
          key: `global:endpoint:${this.normalizeEndpoint(identity.endpoint)}:bucket`,
          policy: globalEndpointPolicy,
          softPct: 100, // Global uses fixed thresholds
          hardPct: 110, // 10% buffer for global policies
        });
      }
    }

    // Check 6: Global system (always present)
    checks.push({
      scope: 'global_system',
      key: 'global:bucket',
      policy: globalPolicy.policies.global,
      softPct: 100,
      hardPct: 110, // 10% buffer for global system
    });

    // 4. Execute all checks in parallel using batch operation
    const results = await this.executeBatchChecks(checks);

    // 5. Find worst state (hard > soft > normal)
    const worstResult = this.aggregateResults(results);

    // 6. Calculate reset time
    const resetTime = this.calculateReset(
      worstResult.tokens,
      worstResult.limit,
      worstResult.policy.refill_rate_per_sec || worstResult.policy.rpm / 60
    );

    // 7. Calculate retry-after if hard throttled
    let retryAfter: number | undefined;
    if (worstResult.state === 'hard') {
      retryAfter = this.tokenBucket.calculateRetryAfter(
        worstResult.tokens,
        worstResult.policy.burst_capacity,
        worstResult.policy.refill_rate_per_sec || worstResult.policy.rpm / 60,
        worstResult.hardPct
      );
    }

    // 8. Return decision
    return {
      allowed: worstResult.state !== 'hard',
      state: worstResult.state,
      scope: worstResult.scope,
      limit: worstResult.limit,
      remaining: Math.floor(worstResult.tokens),
      reset: resetTime,
      retry_after: retryAfter,
      debug: {
        checks_performed: results.map((r) => ({
          scope: r.scope,
          tokens: r.tokens,
          usage_pct: r.usage_pct,
        })),
      },
    };
  }

  /**
   * Execute all checks in parallel using Redis pipeline
   * Split tenant-scoped (batch) and global (individual) checks for Redis Cluster compatibility
   */
  private async executeBatchChecks(
    checks: Array<RateLimitCheck & { softPct: number; hardPct: number }>
  ): Promise<Array<CheckResult & { policy: BucketPolicy; hardPct: number }>> {
    // Split checks by hash tag presence
    const tenantChecks = checks.filter((c) => c.key.startsWith('{tenant:'));
    const globalChecks = checks.filter((c) => c.key.startsWith('global:'));

    // Execute tenant checks in batch (same slot due to hash tag)
    const tenantResults =
      tenantChecks.length > 0 ? await this.executeTenantBatchChecks(tenantChecks) : [];

    // Execute global checks individually (different slots)
    const globalResults = await Promise.all(
      globalChecks.map((check) => this.executeSingleCheck(check))
    );

    // Merge results maintaining original order
    const results: Array<CheckResult & { policy: BucketPolicy; hardPct: number }> = [];
    let tenantIdx = 0,
      globalIdx = 0;

    for (const check of checks) {
      if (check.key.startsWith('{tenant:')) {
        results.push(tenantResults[tenantIdx++]);
      } else {
        results.push(globalResults[globalIdx++]);
      }
    }

    return results;
  }

  /**
   * Execute tenant-scoped checks in batch (all keys share same hash slot)
   */
  private async executeTenantBatchChecks(
    checks: Array<RateLimitCheck & { softPct: number; hardPct: number }>
  ): Promise<Array<CheckResult & { policy: BucketPolicy; hardPct: number }>> {
    // Use existing batch logic via tokenBucket.checkBuckets()
    const tokenBucketChecks = checks.map((check) => ({
      key: check.key,
      policy: check.policy,
      softThresholdPct: check.softPct,
      hardThresholdPct: check.hardPct,
    }));

    const bucketResults = await this.tokenBucket.checkBuckets(tokenBucketChecks);

    return bucketResults.map((result, index) => ({
      scope: checks[index].scope,
      allowed: result.allowed,
      state: result.state,
      tokens: result.tokens_remaining,
      usage_pct: result.usage_pct,
      limit: checks[index].policy.rpm,
      policy: checks[index].policy,
      hardPct: checks[index].hardPct,
    }));
  }

  /**
   * Execute a single check (for global keys that may be on different slots)
   */
  private async executeSingleCheck(
    check: RateLimitCheck & { softPct: number; hardPct: number }
  ): Promise<CheckResult & { policy: BucketPolicy; hardPct: number }> {
    const result = await this.tokenBucket.checkBucket(
      check.key,
      check.policy,
      check.softPct,
      check.hardPct
    );

    return {
      scope: check.scope,
      allowed: result.allowed,
      state: result.state,
      tokens: result.tokens_remaining,
      usage_pct: result.usage_pct,
      limit: check.policy.rpm,
      policy: check.policy,
      hardPct: check.hardPct,
    };
  }

  /**
   * Aggregate results to find worst state
   */
  private aggregateResults(
    results: Array<CheckResult & { policy: BucketPolicy; hardPct: number }>
  ): CheckResult & { policy: BucketPolicy; hardPct: number } {
    // Priority: hard > soft > normal
    const statePriority: Record<ThrottleState, number> = {
      hard: 3,
      soft: 2,
      normal: 1,
    };

    return results.reduce((worst, current) => {
      if (statePriority[current.state] > statePriority[worst.state]) {
        return current;
      }
      return worst;
    });
  }

  /**
   * Calculate reset timestamp
   */
  private calculateReset(tokens: number, capacity: number, refillRatePerSec: number): number {
    return Math.ceil(
      this.tokenBucket.calculateResetTime(tokens, capacity, refillRatePerSec) / 1000
    );
  }

  /**
   * Get endpoint policy from map (handles both Map and object types)
   */
  private getEndpointPolicy(
    endpoints: Map<string, BucketPolicy> | { [key: string]: BucketPolicy },
    endpoint: string
  ): BucketPolicy | null {
    const normalized = this.normalizeEndpoint(endpoint);

    if (endpoints instanceof Map) {
      // Try exact match first
      if (endpoints.has(normalized)) {
        return endpoints.get(normalized)!;
      }

      // Try with original endpoint
      if (endpoints.has(endpoint)) {
        return endpoints.get(endpoint)!;
      }
    } else {
      // Plain object
      if (normalized in endpoints) {
        return endpoints[normalized];
      }

      if (endpoint in endpoints) {
        return endpoints[endpoint];
      }
    }

    return null;
  }

  /**
   * Normalize endpoint path for consistent key generation
   */
  private normalizeEndpoint(endpoint: string): string {
    // Remove query parameters
    const withoutQuery = endpoint.split('?')[0];

    // Remove trailing slash
    const normalized = withoutQuery.replace(/\/$/, '');

    // Convert to safe key format
    return normalized.replace(/[^a-zA-Z0-9\-_/]/g, '_');
  }
}

// Singleton instance
let throttleDecisioner: ThrottleDecisioner | null = null;

export function getThrottleDecisioner(): ThrottleDecisioner {
  if (!throttleDecisioner) {
    throttleDecisioner = new ThrottleDecisioner();
  }
  return throttleDecisioner;
}
