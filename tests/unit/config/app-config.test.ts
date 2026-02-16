import { AppConfig } from '../../../src/config/app-config';

describe('AppConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    AppConfig.reset();

    // Set minimal required env vars
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.REDIS_CLUSTER_NODES = 'localhost:6379';
  });

  afterEach(() => {
    process.env = originalEnv;
    AppConfig.reset();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = AppConfig.getInstance();
      const instance2 = AppConfig.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = AppConfig.getInstance();
      AppConfig.reset();
      const instance2 = AppConfig.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('lazy loading', () => {
    it('should lazily load mongoConfig', () => {
      const config = AppConfig.getInstance();

      // Access twice, should return same instance
      const mongo1 = config.mongoConfig;
      const mongo2 = config.mongoConfig;

      expect(mongo1).toBe(mongo2);
      expect(mongo1.uri).toBe('mongodb://localhost:27017/test');
    });

    it('should lazily load redisConfig', () => {
      const config = AppConfig.getInstance();

      const redis1 = config.redisConfig;
      const redis2 = config.redisConfig;

      expect(redis1).toBe(redis2);
      expect(redis1.clusterNodes).toEqual(['localhost:6379']);
    });

    it('should lazily load all specialized configs', () => {
      const config = AppConfig.getInstance();

      expect(config.mongoConfig).toBeDefined();
      expect(config.redisConfig).toBeDefined();
      expect(config.abuseConfig).toBeDefined();
      expect(config.policyCacheConfig).toBeDefined();
      expect(config.circuitBreakerConfig).toBeDefined();
      expect(config.fallbackConfig).toBeDefined();
      expect(config.loggingConfig).toBeDefined();
      expect(config.metricsConfig).toBeDefined();
      expect(config.jwtConfig).toBeDefined();
      expect(config.rateLimitConfig).toBeDefined();
    });
  });

  describe('base config properties', () => {
    it('should have default nodeEnv and port', () => {
      delete process.env.NODE_ENV;
      delete process.env.PORT;

      const config = AppConfig.getInstance();

      expect(config.nodeEnv).toBe('development');
      expect(config.port).toBe(8080);
    });

    it('should use custom nodeEnv and port', () => {
      process.env.NODE_ENV = 'production';
      process.env.PORT = '3000';

      const config = AppConfig.getInstance();

      expect(config.nodeEnv).toBe('production');
      expect(config.port).toBe(3000);
    });
  });

  describe('validation', () => {
    it('should throw on invalid port (too low)', () => {
      process.env.PORT = '0';

      expect(() => AppConfig.getInstance()).toThrow('PORT must be between 1 and 65535');
    });

    it('should throw on invalid port (too high)', () => {
      process.env.PORT = '99999';

      expect(() => AppConfig.getInstance()).toThrow('PORT must be between 1 and 65535');
    });
  });
});
