/**
 * Config Layer - Central configuration facade
 *
 * This module provides a hierarchical configuration system that replaces
 * scattered process.env access with type-safe, validated configuration.
 *
 * Usage:
 *   import { appConfig } from './config';
 *
 *   // Access any config value
 *   const mongoUri = appConfig.mongoConfig.uri;
 *   const redisNodes = appConfig.redisConfig.clusterNodes;
 *   const isAbuseDetectionEnabled = appConfig.abuseConfig.enabled;
 *
 * Testing:
 *   import { AppConfig } from './config';
 *
 *   beforeEach(() => {
 *     AppConfig.reset(); // Reset singleton for test isolation
 *   });
 */

import { AppConfig as AppConfigClass } from './app-config';

export { AppConfigClass as AppConfig };
export { BaseConfig } from './base-config';

// Export specialized configs for direct use if needed
export { MongoConfig } from './specialized/mongo.config';
export { RedisConfig } from './specialized/redis.config';
export { AbuseConfig } from './specialized/abuse.config';
export { PolicyCacheConfig } from './specialized/policy-cache.config';
export { CircuitBreakerConfig } from './specialized/circuit-breaker.config';
export { FallbackConfig } from './specialized/fallback.config';
export { LoggingConfig } from './specialized/logging.config';
export { MetricsConfig } from './specialized/metrics.config';
export { JwtConfig } from './specialized/jwt.config';
export { RateLimitConfig } from './specialized/rate-limit.config';

// Export helper functions
export {
  getEnv,
  requireEnv,
  getEnvAsInt,
  getEnvAsFloat,
  getEnvAsBool,
} from './env-helpers';

// Export validators
export * from './validators';

/**
 * Singleton instance - use this for all config access
 */
export const appConfig = AppConfigClass.getInstance();
