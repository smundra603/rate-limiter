import { BaseConfig } from './base-config';
import { MongoConfig } from './specialized/mongo.config';
import { RedisConfig } from './specialized/redis.config';
import { AbuseConfig } from './specialized/abuse.config';
import { PolicyCacheConfig } from './specialized/policy-cache.config';
import { CircuitBreakerConfig } from './specialized/circuit-breaker.config';
import { FallbackConfig } from './specialized/fallback.config';
import { LoggingConfig } from './specialized/logging.config';
import { MetricsConfig } from './specialized/metrics.config';
import { JwtConfig } from './specialized/jwt.config';
import { RateLimitConfig } from './specialized/rate-limit.config';

/**
 * AppConfig - Central configuration singleton
 *
 * Provides access to all application configuration through a single facade.
 * Uses lazy loading to instantiate specialized configs only when accessed.
 *
 * Usage:
 *   import { appConfig } from './config';
 *   const mongoUri = appConfig.mongoConfig.uri;
 *   const redisNodes = appConfig.redisConfig.clusterNodes;
 *
 * Testing:
 *   AppConfig.reset(); // Reset singleton between tests
 */
export class AppConfig extends BaseConfig {
  private static instance: AppConfig | null = null;

  // Lazy-loaded config instances
  private _mongoConfig?: MongoConfig;
  private _redisConfig?: RedisConfig;
  private _abuseConfig?: AbuseConfig;
  private _policyCacheConfig?: PolicyCacheConfig;
  private _circuitBreakerConfig?: CircuitBreakerConfig;
  private _fallbackConfig?: FallbackConfig;
  private _loggingConfig?: LoggingConfig;
  private _metricsConfig?: MetricsConfig;
  private _jwtConfig?: JwtConfig;
  private _rateLimitConfig?: RateLimitConfig;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AppConfig {
    if (!AppConfig.instance) {
      AppConfig.instance = new AppConfig();
    }
    return AppConfig.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    AppConfig.instance = null;
  }

  /**
   * MongoDB configuration
   */
  get mongoConfig(): MongoConfig {
    if (!this._mongoConfig) {
      this._mongoConfig = new MongoConfig();
    }
    return this._mongoConfig;
  }

  /**
   * Redis configuration
   */
  get redisConfig(): RedisConfig {
    if (!this._redisConfig) {
      this._redisConfig = new RedisConfig();
    }
    return this._redisConfig;
  }

  /**
   * Abuse detection configuration
   */
  get abuseConfig(): AbuseConfig {
    if (!this._abuseConfig) {
      this._abuseConfig = new AbuseConfig();
    }
    return this._abuseConfig;
  }

  /**
   * Policy cache configuration
   */
  get policyCacheConfig(): PolicyCacheConfig {
    if (!this._policyCacheConfig) {
      this._policyCacheConfig = new PolicyCacheConfig();
    }
    return this._policyCacheConfig;
  }

  /**
   * Circuit breaker configuration
   */
  get circuitBreakerConfig(): CircuitBreakerConfig {
    if (!this._circuitBreakerConfig) {
      this._circuitBreakerConfig = new CircuitBreakerConfig();
    }
    return this._circuitBreakerConfig;
  }

  /**
   * Fallback configuration
   */
  get fallbackConfig(): FallbackConfig {
    if (!this._fallbackConfig) {
      this._fallbackConfig = new FallbackConfig();
    }
    return this._fallbackConfig;
  }

  /**
   * Logging configuration
   */
  get loggingConfig(): LoggingConfig {
    if (!this._loggingConfig) {
      this._loggingConfig = new LoggingConfig();
    }
    return this._loggingConfig;
  }

  /**
   * Metrics configuration
   */
  get metricsConfig(): MetricsConfig {
    if (!this._metricsConfig) {
      this._metricsConfig = new MetricsConfig();
    }
    return this._metricsConfig;
  }

  /**
   * JWT configuration
   */
  get jwtConfig(): JwtConfig {
    if (!this._jwtConfig) {
      this._jwtConfig = new JwtConfig();
    }
    return this._jwtConfig;
  }

  /**
   * Rate limit mode configuration
   */
  get rateLimitConfig(): RateLimitConfig {
    if (!this._rateLimitConfig) {
      this._rateLimitConfig = new RateLimitConfig();
    }
    return this._rateLimitConfig;
  }

  /**
   * Validate base configuration
   */
  protected validate(): void {
    if (this.port <= 0 || this.port > 65535) {
      throw new Error('PORT must be between 1 and 65535');
    }
  }
}
