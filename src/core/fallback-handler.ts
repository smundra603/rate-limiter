import { RequestIdentity, RateLimitDecision, RateLimitMode } from '../types';
import logger, { logFallbackActivation } from '../utils/logger';
import { recordFallbackActivation } from '../metrics/metrics';
import { appConfig } from '../config';

interface FallbackBucket {
  requests: number[];
  lastCleanup: number;
}

export class FallbackHandler {
  private buckets: Map<string, FallbackBucket> = new Map();
  private readonly windowMs = 60000; // 1 minute sliding window
  private readonly fallbackRPM: number;
  private readonly fallbackBurst: number;
  private cleanupIntervalId?: NodeJS.Timeout;

  constructor() {
    const { fallbackConfig } = appConfig;

    this.fallbackRPM = fallbackConfig.rpm;
    this.fallbackBurst = fallbackConfig.burstCapacity;

    // Start periodic cleanup of old buckets
    this.startCleanup();

    logger.info('Fallback handler initialized', {
      rpm: this.fallbackRPM,
      burst: this.fallbackBurst,
    });
  }

  /**
   * Check rate limit using in-memory sliding window
   */
  checkRateLimit(identity: RequestIdentity, mode: RateLimitMode): RateLimitDecision {
    const key = this.getBucketKey(identity);
    const now = Date.now();

    // Get or create bucket
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        requests: [],
        lastCleanup: now,
      };
      this.buckets.set(key, bucket);
    }

    // Remove requests outside the sliding window
    const windowStart = now - this.windowMs;
    bucket.requests = bucket.requests.filter((timestamp) => timestamp > windowStart);
    bucket.lastCleanup = now;

    // Count requests in current window
    const requestCount = bucket.requests.length;
    const remaining = Math.max(0, this.fallbackRPM - requestCount);

    // Determine if request is allowed
    const allowed = requestCount < this.fallbackRPM;

    // Add current request if allowed
    if (allowed) {
      bucket.requests.push(now);
    }

    // Calculate reset time (end of current window)
    const reset = Math.ceil((now + this.windowMs) / 1000);

    // Determine state based on usage
    const usagePct = (requestCount / this.fallbackRPM) * 100;
    let state: 'normal' | 'soft' | 'hard' = 'normal';

    // Fallback uses conservative thresholds
    const softThresholdPct = 100; // Warnings start at 100%
    const hardThresholdPct = 110; // Reject at 110% (10% buffer)

    if (usagePct >= hardThresholdPct) {
      state = 'hard';
    } else if (usagePct >= softThresholdPct) {
      state = 'soft';
    }

    // Calculate retry after if throttled
    let retryAfter: number | undefined;
    if (!allowed) {
      // Find oldest request in window
      const oldestRequest = Math.min(...bucket.requests);
      const oldestAge = now - oldestRequest;
      retryAfter = Math.ceil((this.windowMs - oldestAge) / 1000);
    }

    return {
      allowed: mode === 'enforcement' ? allowed : true, // Fail open in non-enforcement modes
      state,
      scope: 'tenant_global', // Fallback uses tenant-level limiting
      limit: this.fallbackRPM,
      remaining,
      reset,
      retry_after: retryAfter,
      debug: {
        checks_performed: [
          {
            scope: 'tenant_global',
            tokens: remaining,
            usage_pct: usagePct,
          },
        ],
      },
    };
  }

  /**
   * Generate bucket key from identity
   */
  private getBucketKey(identity: RequestIdentity): string {
    return `fallback:${identity.tenant_id}`;
  }

  /**
   * Start periodic cleanup of old buckets
   */
  private startCleanup(): void {
    // Clean up every 5 minutes
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupOldBuckets();
    }, 300000);
  }

  /**
   * Remove buckets that haven't been used recently
   */
  private cleanupOldBuckets(): void {
    const now = Date.now();
    const maxAge = this.windowMs * 2; // Keep buckets for 2 windows
    let cleaned = 0;

    for (const [key, bucket] of this.buckets.entries()) {
      const age = now - bucket.lastCleanup;
      if (age > maxAge) {
        this.buckets.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Fallback buckets cleaned', { cleaned, remaining: this.buckets.size });
    }
  }

  /**
   * Get fallback handler statistics
   */
  getStats() {
    return {
      active_buckets: this.buckets.size,
      fallback_rpm: this.fallbackRPM,
      fallback_burst: this.fallbackBurst,
      window_ms: this.windowMs,
    };
  }

  /**
   * Reset all buckets (for testing)
   */
  reset(): void {
    this.buckets.clear();
    logger.debug('Fallback handler reset');
  }

  /**
   * Stop cleanup interval
   */
  stop(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
    this.buckets.clear();
    logger.info('Fallback handler stopped');
  }
}

/**
 * Wrapper to execute rate limit check with fallback
 */
export async function executeWithFallback<T>(
  operation: () => Promise<T>,
  fallbackOperation: () => T,
  reason: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logFallbackActivation(reason, error);
    recordFallbackActivation(reason);
    return fallbackOperation();
  }
}

// Singleton instance
let fallbackHandler: FallbackHandler | null = null;

export function getFallbackHandler(): FallbackHandler {
  if (!fallbackHandler) {
    fallbackHandler = new FallbackHandler();
  }
  return fallbackHandler;
}

export function stopFallbackHandler(): void {
  if (fallbackHandler) {
    fallbackHandler.stop();
    fallbackHandler = null;
  }
}
