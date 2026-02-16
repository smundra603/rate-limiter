import { AppConfig } from '../../../../src/config/app-config';

describe('RedisConfig', () => {
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

  describe('defaults', () => {
    it('should use default values', () => {
      const config = AppConfig.getInstance().redisConfig;

      expect(config.clusterNodes).toEqual(['localhost:6379']);
      expect(config.password).toBeUndefined();
      expect(config.timeoutMs).toBe(100);
      expect(config.maxRetries).toBe(3);
      expect(config.poolSize).toBe(50);
      expect(config.sentinels).toBeUndefined();
      expect(config.masterName).toBe('mymaster');
    });
  });

  describe('custom values', () => {
    it('should parse custom values', () => {
      process.env.REDIS_CLUSTER_NODES = 'redis1:6379,redis2:6379,redis3:6379';
      process.env.REDIS_PASSWORD = 'secret';
      process.env.REDIS_TIMEOUT_MS = '200';
      process.env.REDIS_MAX_RETRIES = '5';
      process.env.REDIS_POOL_SIZE = '100';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.clusterNodes).toEqual(['redis1:6379', 'redis2:6379', 'redis3:6379']);
      expect(config.password).toBe('secret');
      expect(config.timeoutMs).toBe(200);
      expect(config.maxRetries).toBe(5);
      expect(config.poolSize).toBe(100);
    });

    it('should parse sentinel configuration', () => {
      process.env.REDIS_SENTINELS = 'sentinel1:26379,sentinel2:26379';
      process.env.REDIS_MASTER_NAME = 'mymaster-prod';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.sentinels).toBe('sentinel1:26379,sentinel2:26379');
      expect(config.masterName).toBe('mymaster-prod');
    });
  });

  describe('derived properties', () => {
    it('should detect cluster mode (multiple nodes, no sentinels)', () => {
      process.env.REDIS_CLUSTER_NODES = 'redis1:6379,redis2:6379,redis3:6379';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.isCluster).toBe(true);
      expect(config.isSentinel).toBe(false);
    });

    it('should not be cluster mode with single node', () => {
      process.env.REDIS_CLUSTER_NODES = 'localhost:6379';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.isCluster).toBe(false);
      expect(config.isSentinel).toBe(false);
    });

    it('should detect sentinel mode', () => {
      process.env.REDIS_SENTINELS = 'sentinel1:26379,sentinel2:26379';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.isSentinel).toBe(true);
      expect(config.isCluster).toBe(false);
    });

    it('should parse sentinel nodes', () => {
      process.env.REDIS_SENTINELS = 'sentinel1:26379,sentinel2:26380';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.sentinelNodes).toEqual([
        { host: 'sentinel1', port: 26379 },
        { host: 'sentinel2', port: 26380 },
      ]);
    });

    it('should use default port for sentinels without port', () => {
      process.env.REDIS_SENTINELS = 'sentinel1,sentinel2:26380';

      const config = AppConfig.getInstance().redisConfig;

      expect(config.sentinelNodes).toEqual([
        { host: 'sentinel1', port: 26379 },
        { host: 'sentinel2', port: 26380 },
      ]);
    });

    it('should return empty array for sentinelNodes when no sentinels', () => {
      const config = AppConfig.getInstance().redisConfig;

      expect(config.sentinelNodes).toEqual([]);
    });
  });

  describe('validation', () => {
    it('should throw when cluster nodes empty', () => {
      process.env.REDIS_CLUSTER_NODES = '';

      expect(() => AppConfig.getInstance().redisConfig).toThrow(
        'Required environment variable REDIS_CLUSTER_NODES is not set'
      );
    });

    it('should throw on negative timeout', () => {
      process.env.REDIS_TIMEOUT_MS = '-1';

      expect(() => AppConfig.getInstance().redisConfig).toThrow('REDIS_TIMEOUT_MS must be >= 0');
    });

    it('should throw on negative max retries', () => {
      process.env.REDIS_MAX_RETRIES = '-1';

      expect(() => AppConfig.getInstance().redisConfig).toThrow('REDIS_MAX_RETRIES must be >= 0');
    });

    it('should throw on pool size less than 1', () => {
      process.env.REDIS_POOL_SIZE = '0';

      expect(() => AppConfig.getInstance().redisConfig).toThrow('REDIS_POOL_SIZE must be >= 1');
    });
  });
});
