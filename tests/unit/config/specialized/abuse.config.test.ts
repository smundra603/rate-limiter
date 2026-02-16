import { AppConfig } from '../../../../src/config/app-config';

describe('AbuseConfig', () => {
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
      const config = AppConfig.getInstance().abuseConfig;

      expect(config.enabled).toBe(true);
      expect(config.checkIntervalMs).toBe(60000);
      expect(config.throttleThreshold).toBe(0.8);
      expect(config.detectionWindowMinutes).toBe(5);
      expect(config.penaltyDurationMs).toBe(300000);
      expect(config.penaltyType).toBe('adaptive');
      expect(config.penaltyMultiplier).toBe(0.1);
    });
  });

  describe('custom values', () => {
    it('should parse custom values', () => {
      process.env.ABUSE_DETECTION_ENABLED = 'false';
      process.env.ABUSE_CHECK_INTERVAL_MS = '30000';
      process.env.ABUSE_THROTTLE_THRESHOLD = '0.9';
      process.env.ABUSE_DETECTION_WINDOW_MINUTES = '10';
      process.env.ABUSE_PENALTY_DURATION_MS = '600000';
      process.env.ABUSE_PENALTY_TYPE = 'fixed';
      process.env.ABUSE_PENALTY_MULTIPLIER = '0.2';

      const config = AppConfig.getInstance().abuseConfig;

      expect(config.enabled).toBe(false);
      expect(config.checkIntervalMs).toBe(30000);
      expect(config.throttleThreshold).toBe(0.9);
      expect(config.detectionWindowMinutes).toBe(10);
      expect(config.penaltyDurationMs).toBe(600000);
      expect(config.penaltyType).toBe('fixed');
      expect(config.penaltyMultiplier).toBe(0.2);
    });
  });

  describe('validation', () => {
    it('should throw on invalid penalty type', () => {
      process.env.ABUSE_PENALTY_TYPE = 'invalid';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        "ABUSE_PENALTY_TYPE must be 'fixed' or 'adaptive'"
      );
    });

    it('should throw on negative check interval', () => {
      process.env.ABUSE_CHECK_INTERVAL_MS = '0';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_CHECK_INTERVAL_MS must be greater than 0'
      );
    });

    it('should throw on throttle threshold out of range (low)', () => {
      process.env.ABUSE_THROTTLE_THRESHOLD = '-0.1';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_THROTTLE_THRESHOLD must be between 0 and 1'
      );
    });

    it('should throw on throttle threshold out of range (high)', () => {
      process.env.ABUSE_THROTTLE_THRESHOLD = '1.5';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_THROTTLE_THRESHOLD must be between 0 and 1'
      );
    });

    it('should throw on negative detection window', () => {
      process.env.ABUSE_DETECTION_WINDOW_MINUTES = '0';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_DETECTION_WINDOW_MINUTES must be greater than 0'
      );
    });

    it('should throw on negative penalty duration', () => {
      process.env.ABUSE_PENALTY_DURATION_MS = '0';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_PENALTY_DURATION_MS must be greater than 0'
      );
    });

    it('should throw on penalty multiplier out of range (low)', () => {
      process.env.ABUSE_PENALTY_MULTIPLIER = '-0.1';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_PENALTY_MULTIPLIER must be between 0 and 1'
      );
    });

    it('should throw on penalty multiplier out of range (high)', () => {
      process.env.ABUSE_PENALTY_MULTIPLIER = '1.5';

      expect(() => AppConfig.getInstance().abuseConfig).toThrow(
        'ABUSE_PENALTY_MULTIPLIER must be between 0 and 1'
      );
    });
  });
});
