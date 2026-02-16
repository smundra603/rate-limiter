import { getRedisClient } from '../storage/redis-client';
import { BucketPolicy, TokenBucketResult, ThrottleState } from '../types';
import logger from '../utils/logger';

export class TokenBucketEngine {
  private redisClient = getRedisClient();

  /**
   * Check a single token bucket
   */
  async checkBucket(
    key: string,
    policy: BucketPolicy,
    softThresholdPct: number,
    hardThresholdPct: number
  ): Promise<TokenBucketResult> {
    try {
      const refillRatePerSec = policy.refill_rate_per_sec || policy.rpm / 60;

      const result = await this.redisClient.checkTokenBucket(
        key,
        policy.burst_capacity,
        refillRatePerSec,
        softThresholdPct,
        hardThresholdPct
      );

      return {
        allowed: result.allowed,
        state: this.mapStateToEnum(result.state),
        tokens_remaining: result.tokens,
        usage_pct: result.usagePct,
      };
    } catch (error) {
      logger.error('Token bucket check failed', { key, error });
      throw error;
    }
  }

  /**
   * Check multiple token buckets in parallel
   */
  async checkBuckets(
    checks: Array<{
      key: string;
      policy: BucketPolicy;
      softThresholdPct: number;
      hardThresholdPct: number;
    }>
  ): Promise<TokenBucketResult[]> {
    try {
      const redisChecks = checks.map((check) => ({
        key: check.key,
        capacity: check.policy.burst_capacity,
        refillRatePerSec: check.policy.refill_rate_per_sec || check.policy.rpm / 60,
        softThresholdPct: check.softThresholdPct,
        hardThresholdPct: check.hardThresholdPct,
      }));

      const results = await this.redisClient.batchCheckTokenBuckets(redisChecks);

      return results.map((result) => ({
        allowed: result.allowed,
        state: this.mapStateToEnum(result.state),
        tokens_remaining: result.tokens,
        usage_pct: result.usagePct,
      }));
    } catch (error) {
      logger.error('Batch token bucket check failed', { error });
      throw error;
    }
  }

  /**
   * Get bucket state without consuming tokens
   */
  async getBucketState(key: string): Promise<{ tokens: number; lastRefillMs: number } | null> {
    try {
      return await this.redisClient.getBucketState(key);
    } catch (error) {
      logger.error('Failed to get bucket state', { key, error });
      throw error;
    }
  }

  /**
   * Calculate refill rate from RPM
   */
  calculateRefillRate(rpm: number): number {
    return rpm / 60;
  }

  /**
   * Calculate time until bucket resets (when it will have full capacity)
   */
  calculateResetTime(currentTokens: number, capacity: number, refillRatePerSec: number): number {
    if (currentTokens >= capacity) {
      return Date.now();
    }

    const tokensNeeded = capacity - currentTokens;
    const secondsToReset = tokensNeeded / refillRatePerSec;
    return Date.now() + secondsToReset * 1000;
  }

  /**
   * Calculate retry-after duration for hard throttle
   */
  calculateRetryAfter(
    currentTokens: number,
    capacity: number,
    refillRatePerSec: number,
    hardThresholdPct: number
  ): number {
    // Calculate tokens needed to get below hard threshold
    const maxAllowedTokensConsumed = (capacity * hardThresholdPct) / 100;
    const currentTokensConsumed = capacity - currentTokens;

    if (currentTokensConsumed <= maxAllowedTokensConsumed) {
      return 0; // Already below threshold
    }

    const tokensToRefill = currentTokensConsumed - maxAllowedTokensConsumed;
    const secondsToWait = tokensToRefill / refillRatePerSec;

    // Round up to nearest second
    return Math.ceil(secondsToWait);
  }

  /**
   * Map numeric state to enum
   */
  private mapStateToEnum(state: number): ThrottleState {
    switch (state) {
      case 0:
        return 'normal';
      case 1:
        return 'soft';
      case 2:
        return 'hard';
      default:
        return 'normal';
    }
  }

  /**
   * Validate bucket policy
   */
  validatePolicy(policy: BucketPolicy): boolean {
    if (policy.rpm <= 0 || policy.rps <= 0 || policy.burst_capacity <= 0) {
      logger.warn('Invalid bucket policy', { policy });
      return false;
    }

    // Ensure burst capacity is reasonable relative to RPM
    const minBurstCapacity = policy.rpm / 60; // At least 1 second worth
    if (policy.burst_capacity < minBurstCapacity) {
      logger.warn('Burst capacity too low', {
        burst_capacity: policy.burst_capacity,
        min_recommended: minBurstCapacity,
      });
      return false;
    }

    return true;
  }
}

// Singleton instance
let tokenBucketEngine: TokenBucketEngine | null = null;

export function getTokenBucketEngine(): TokenBucketEngine {
  if (!tokenBucketEngine) {
    tokenBucketEngine = new TokenBucketEngine();
  }
  return tokenBucketEngine;
}
