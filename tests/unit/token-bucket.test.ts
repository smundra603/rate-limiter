/**
 * Unit tests for Token Bucket Engine
 */

import { AppConfig } from '../../src/config';
import { TokenBucketEngine } from '../../src/core/token-bucket';
import { BucketPolicy } from '../../src/types';

describe('TokenBucketEngine', () => {
  let engine: TokenBucketEngine;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set minimal required env vars
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.REDIS_CLUSTER_NODES = 'localhost:6379';
    AppConfig.reset();
    engine = new TokenBucketEngine();
  });

  afterEach(() => {
    process.env = originalEnv;
    AppConfig.reset();
  });

  describe('calculateRefillRate', () => {
    it('should calculate refill rate from RPM', () => {
      expect(engine.calculateRefillRate(60)).toBe(1); // 60 RPM = 1/sec
      expect(engine.calculateRefillRate(120)).toBe(2); // 120 RPM = 2/sec
      expect(engine.calculateRefillRate(30)).toBe(0.5); // 30 RPM = 0.5/sec
    });

    it('should handle edge cases', () => {
      expect(engine.calculateRefillRate(0)).toBe(0);
      expect(engine.calculateRefillRate(1)).toBeCloseTo(0.0167, 4);
    });
  });

  describe('calculateResetTime', () => {
    it('should return current time if bucket is full', () => {
      const now = Date.now();
      const resetTime = engine.calculateResetTime(100, 100, 10);
      expect(resetTime).toBeGreaterThanOrEqual(now);
      expect(resetTime).toBeLessThanOrEqual(now + 100);
    });

    it('should calculate correct reset time for empty bucket', () => {
      const now = Date.now();
      const capacity = 100;
      const refillRate = 10; // 10 tokens/sec
      const currentTokens = 0;

      const resetTime = engine.calculateResetTime(currentTokens, capacity, refillRate);
      const expectedResetTime = now + (capacity / refillRate) * 1000; // 10 seconds

      expect(resetTime).toBeGreaterThanOrEqual(expectedResetTime - 100);
      expect(resetTime).toBeLessThanOrEqual(expectedResetTime + 100);
    });

    it('should calculate correct reset time for half-full bucket', () => {
      const capacity = 100;
      const refillRate = 10;
      const currentTokens = 50;

      const resetTime = engine.calculateResetTime(currentTokens, capacity, refillRate);
      const now = Date.now();
      const expectedDelay = ((capacity - currentTokens) / refillRate) * 1000; // 5 seconds

      expect(resetTime).toBeGreaterThanOrEqual(now + expectedDelay - 100);
      expect(resetTime).toBeLessThanOrEqual(now + expectedDelay + 100);
    });
  });

  describe('calculateRetryAfter', () => {
    it('should return 0 if below hard threshold', () => {
      const retryAfter = engine.calculateRetryAfter(50, 100, 10, 105);
      expect(retryAfter).toBe(0);
    });

    it('should calculate correct retry time when over threshold', () => {
      const capacity = 100;
      const currentTokens = 0; // All consumed
      const refillRate = 10; // 10 tokens/sec
      const hardThreshold = 105;

      // At 105% threshold, we need 5 tokens to refill
      const retryAfter = engine.calculateRetryAfter(
        currentTokens,
        capacity,
        refillRate,
        hardThreshold
      );

      // Should need to wait for at least 0.5 seconds to get below 105%
      expect(retryAfter).toBeGreaterThanOrEqual(0);
      expect(retryAfter).toBeLessThanOrEqual(2);
    });

    it('should round up to nearest second', () => {
      const retryAfter = engine.calculateRetryAfter(99, 100, 10, 105);
      expect(Number.isInteger(retryAfter)).toBe(true);
    });
  });

  describe('validatePolicy', () => {
    it('should validate correct policy', () => {
      const policy: BucketPolicy = {
        rpm: 100,
        rps: 10,
        burst_capacity: 150,
        refill_rate_per_sec: 1.67,
      };

      expect(engine.validatePolicy(policy)).toBe(true);
    });

    it('should reject policy with zero or negative values', () => {
      const invalidPolicies: BucketPolicy[] = [
        { rpm: 0, rps: 10, burst_capacity: 150 },
        { rpm: 100, rps: 0, burst_capacity: 150 },
        { rpm: 100, rps: 10, burst_capacity: 0 },
        { rpm: -1, rps: 10, burst_capacity: 150 },
      ];

      invalidPolicies.forEach((policy) => {
        expect(engine.validatePolicy(policy)).toBe(false);
      });
    });

    it('should warn about insufficient burst capacity', () => {
      const policy: BucketPolicy = {
        rpm: 100,
        rps: 10,
        burst_capacity: 1, // Too low
      };

      expect(engine.validatePolicy(policy)).toBe(false);
    });

    it('should accept policy with burst capacity equal to minimum', () => {
      const rpm = 60;
      const policy: BucketPolicy = {
        rpm,
        rps: 1,
        burst_capacity: rpm / 60, // Exactly 1 second worth
      };

      expect(engine.validatePolicy(policy)).toBe(true);
    });
  });
});
