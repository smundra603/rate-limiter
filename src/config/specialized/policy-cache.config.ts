import { getEnvAsInt } from '../env-helpers';

/**
 * PolicyCacheConfig - Policy caching configuration
 *
 * Environment variables:
 * - POLICY_CACHE_TTL_MS: Time-to-live for cached policies (default: 300000)
 * - POLICY_CACHE_MAX_SIZE: Maximum number of cached policies (default: 10000)
 * - POLICY_CACHE_REFRESH_INTERVAL_MS: How often to refresh cache (default: 60000)
 */
export class PolicyCacheConfig {
  readonly ttlMs: number;
  readonly maxSize: number;
  readonly refreshIntervalMs: number;

  constructor() {
    this.ttlMs = getEnvAsInt('POLICY_CACHE_TTL_MS', 300000);
    this.maxSize = getEnvAsInt('POLICY_CACHE_MAX_SIZE', 10000);
    this.refreshIntervalMs = getEnvAsInt('POLICY_CACHE_REFRESH_INTERVAL_MS', 60000);
    this.validate();
  }

  protected validate(): void {
    if (this.ttlMs <= 0) {
      throw new Error('POLICY_CACHE_TTL_MS must be greater than 0');
    }

    if (this.maxSize <= 0) {
      throw new Error('POLICY_CACHE_MAX_SIZE must be greater than 0');
    }

    if (this.refreshIntervalMs <= 0) {
      throw new Error('POLICY_CACHE_REFRESH_INTERVAL_MS must be greater than 0');
    }
  }
}
