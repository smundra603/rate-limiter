import { AppConfig } from '../../../../src/config/app-config';

describe('MongoConfig', () => {
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
      const config = AppConfig.getInstance().mongoConfig;

      expect(config.uri).toBe('mongodb://localhost:27017/test');
      expect(config.poolSize).toBe(10);
      expect(config.connectTimeoutMs).toBe(10000);
    });
  });

  describe('custom values', () => {
    it('should parse custom values', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo:27017/prod';
      process.env.MONGO_POOL_SIZE = '20';
      process.env.MONGO_CONNECT_TIMEOUT_MS = '5000';

      const config = AppConfig.getInstance().mongoConfig;

      expect(config.uri).toBe('mongodb://user:pass@mongo:27017/prod');
      expect(config.poolSize).toBe(20);
      expect(config.connectTimeoutMs).toBe(5000);
    });

    it('should support mongodb+srv URIs', () => {
      process.env.MONGODB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/db';

      const config = AppConfig.getInstance().mongoConfig;

      expect(config.uri).toBe('mongodb+srv://user:pass@cluster.mongodb.net/db');
    });
  });

  describe('derived properties', () => {
    it('should sanitize URI with credentials', () => {
      process.env.MONGODB_URI = 'mongodb://user:password123@mongo:27017/mydb';

      const config = AppConfig.getInstance().mongoConfig;

      expect(config.sanitizedUri).toBe('mongodb://***:***@mongo:27017/mydb');
    });

    it('should return URI unchanged when no credentials', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017/test';

      const config = AppConfig.getInstance().mongoConfig;

      expect(config.sanitizedUri).toBe('mongodb://localhost:27017/test');
    });

    it('should handle malformed URIs gracefully in sanitize', () => {
      // Use a truly malformed URI that URL constructor will reject
      process.env.MONGODB_URI = 'mongodb://[invalid';

      const config = AppConfig.getInstance().mongoConfig;

      expect(config.sanitizedUri).toBe('mongodb://***@***/***');
    });
  });

  describe('validation', () => {
    it('should throw when URI missing', () => {
      delete process.env.MONGODB_URI;

      expect(() => AppConfig.getInstance().mongoConfig).toThrow(
        'Required environment variable MONGODB_URI is not set'
      );
    });

    it('should throw on invalid URI scheme', () => {
      process.env.MONGODB_URI = 'http://localhost:27017/test';

      expect(() => AppConfig.getInstance().mongoConfig).toThrow(
        'MONGODB_URI must start with mongodb:// or mongodb+srv://'
      );
    });

    it('should throw on pool size <= 0', () => {
      process.env.MONGO_POOL_SIZE = '0';

      expect(() => AppConfig.getInstance().mongoConfig).toThrow(
        'MONGO_POOL_SIZE must be greater than 0'
      );
    });

    it('should throw on connect timeout <= 0', () => {
      process.env.MONGO_CONNECT_TIMEOUT_MS = '0';

      expect(() => AppConfig.getInstance().mongoConfig).toThrow(
        'MONGO_CONNECT_TIMEOUT_MS must be greater than 0'
      );
    });
  });
});
