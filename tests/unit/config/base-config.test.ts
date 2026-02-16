import { BaseConfig } from '../../../src/config/base-config';
import { getEnv, requireEnv, getEnvAsInt, getEnvAsFloat, getEnvAsBool } from '../../../src/config/env-helpers';

// Concrete implementation for testing abstract BaseConfig
class TestConfig extends BaseConfig {
  protected validate(): void {
    // No validation needed for test
  }
}

describe('BaseConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should set default values when env vars not provided', () => {
      delete process.env.NODE_ENV;
      delete process.env.PORT;

      const config = new TestConfig();

      expect(config.nodeEnv).toBe('development');
      expect(config.port).toBe(8080);
    });

    it('should use env vars when provided', () => {
      process.env.NODE_ENV = 'production';
      process.env.PORT = '3000';

      const config = new TestConfig();

      expect(config.nodeEnv).toBe('production');
      expect(config.port).toBe(3000);
    });
  });

  describe('getEnv', () => {
    it('should return env value when set', () => {
      process.env.TEST_VAR = 'test-value';
      const config = new TestConfig();

      expect(config['getEnv']('TEST_VAR', 'default')).toBe('test-value');
    });

    it('should return default when env var not set', () => {
      delete process.env.TEST_VAR;
      const config = new TestConfig();

      expect(config['getEnv']('TEST_VAR', 'default')).toBe('default');
    });
  });

  describe('requireEnv', () => {
    it('should return value when env var is set', () => {
      process.env.REQUIRED_VAR = 'required-value';
      const config = new TestConfig();

      expect(config['requireEnv']('REQUIRED_VAR')).toBe('required-value');
    });

    it('should throw when env var is not set', () => {
      delete process.env.REQUIRED_VAR;

      expect(() => new TestConfig()['requireEnv']('REQUIRED_VAR')).toThrow(
        'Required environment variable REQUIRED_VAR is not set'
      );
    });

    it('should throw when env var is empty string', () => {
      process.env.REQUIRED_VAR = '';

      expect(() => new TestConfig()['requireEnv']('REQUIRED_VAR')).toThrow(
        'Required environment variable REQUIRED_VAR is not set'
      );
    });
  });

  describe('getEnvAsInt', () => {
    it('should parse valid integer', () => {
      process.env.INT_VAR = '123';
      const config = new TestConfig();

      expect(config['getEnvAsInt']('INT_VAR', 0)).toBe(123);
    });

    it('should return default when not set', () => {
      delete process.env.INT_VAR;
      const config = new TestConfig();

      expect(config['getEnvAsInt']('INT_VAR', 42)).toBe(42);
    });

    it('should throw on invalid integer', () => {
      process.env.INT_VAR = 'not-a-number';

      expect(() => new TestConfig()['getEnvAsInt']('INT_VAR', 0)).toThrow(
        'Environment variable INT_VAR must be a valid integer'
      );
    });

    it('should parse negative integers', () => {
      process.env.INT_VAR = '-456';
      const config = new TestConfig();

      expect(config['getEnvAsInt']('INT_VAR', 0)).toBe(-456);
    });
  });

  describe('getEnvAsFloat', () => {
    it('should parse valid float', () => {
      process.env.FLOAT_VAR = '3.14';
      const config = new TestConfig();

      expect(config['getEnvAsFloat']('FLOAT_VAR', 0)).toBe(3.14);
    });

    it('should parse integer as float', () => {
      process.env.FLOAT_VAR = '42';
      const config = new TestConfig();

      expect(config['getEnvAsFloat']('FLOAT_VAR', 0)).toBe(42.0);
    });

    it('should return default when not set', () => {
      delete process.env.FLOAT_VAR;
      const config = new TestConfig();

      expect(config['getEnvAsFloat']('FLOAT_VAR', 2.71)).toBe(2.71);
    });

    it('should throw on invalid float', () => {
      process.env.FLOAT_VAR = 'not-a-number';

      expect(() => new TestConfig()['getEnvAsFloat']('FLOAT_VAR', 0)).toThrow(
        'Environment variable FLOAT_VAR must be a valid number'
      );
    });
  });

  describe('getEnvAsBool', () => {
    it('should return false when value is "false"', () => {
      process.env.BOOL_VAR = 'false';
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', true)).toBe(false);
    });

    it('should return false when value is "FALSE"', () => {
      process.env.BOOL_VAR = 'FALSE';
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', true)).toBe(false);
    });

    it('should return true for truthy values', () => {
      process.env.BOOL_VAR = 'true';
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', false)).toBe(true);
    });

    it('should return true for "1"', () => {
      process.env.BOOL_VAR = '1';
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', false)).toBe(true);
    });

    it('should return default when not set', () => {
      delete process.env.BOOL_VAR;
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', true)).toBe(true);
      expect(config['getEnvAsBool']('BOOL_VAR', false)).toBe(false);
    });

    it('should return default when empty string', () => {
      process.env.BOOL_VAR = '';
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', true)).toBe(true);
    });

    it('should return false for "0"', () => {
      process.env.BOOL_VAR = '0';
      const config = new TestConfig();

      expect(config['getEnvAsBool']('BOOL_VAR', true)).toBe(false);
    });
  });

  describe('helper functions (direct)', () => {
    describe('getEnv', () => {
      it('should return env value when set', () => {
        process.env.TEST_VAR = 'test-value';
        expect(getEnv('TEST_VAR', 'default')).toBe('test-value');
      });

      it('should return default when env var not set', () => {
        delete process.env.TEST_VAR;
        expect(getEnv('TEST_VAR', 'default')).toBe('default');
      });

      it('should return default when env var is empty string', () => {
        process.env.TEST_VAR = '';
        expect(getEnv('TEST_VAR', 'default')).toBe('default');
      });
    });

    describe('requireEnv', () => {
      it('should return value when env var is set', () => {
        process.env.REQUIRED_VAR = 'required-value';
        expect(requireEnv('REQUIRED_VAR')).toBe('required-value');
      });

      it('should throw when env var is not set', () => {
        delete process.env.REQUIRED_VAR;
        expect(() => requireEnv('REQUIRED_VAR')).toThrow(
          'Required environment variable REQUIRED_VAR is not set'
        );
      });

      it('should throw when env var is empty string', () => {
        process.env.REQUIRED_VAR = '';
        expect(() => requireEnv('REQUIRED_VAR')).toThrow(
          'Required environment variable REQUIRED_VAR is not set'
        );
      });
    });

    describe('getEnvAsInt', () => {
      it('should parse valid integer', () => {
        process.env.INT_VAR = '123';
        expect(getEnvAsInt('INT_VAR', 0)).toBe(123);
      });

      it('should return default when not set', () => {
        delete process.env.INT_VAR;
        expect(getEnvAsInt('INT_VAR', 42)).toBe(42);
      });

      it('should throw on invalid integer', () => {
        process.env.INT_VAR = 'not-a-number';
        expect(() => getEnvAsInt('INT_VAR', 0)).toThrow(
          'Environment variable INT_VAR must be a valid integer'
        );
      });

      it('should parse negative integers', () => {
        process.env.INT_VAR = '-456';
        expect(getEnvAsInt('INT_VAR', 0)).toBe(-456);
      });
    });

    describe('getEnvAsFloat', () => {
      it('should parse valid float', () => {
        process.env.FLOAT_VAR = '3.14';
        expect(getEnvAsFloat('FLOAT_VAR', 0)).toBe(3.14);
      });

      it('should parse integer as float', () => {
        process.env.FLOAT_VAR = '42';
        expect(getEnvAsFloat('FLOAT_VAR', 0)).toBe(42.0);
      });

      it('should return default when not set', () => {
        delete process.env.FLOAT_VAR;
        expect(getEnvAsFloat('FLOAT_VAR', 2.71)).toBe(2.71);
      });

      it('should throw on invalid float', () => {
        process.env.FLOAT_VAR = 'not-a-number';
        expect(() => getEnvAsFloat('FLOAT_VAR', 0)).toThrow(
          'Environment variable FLOAT_VAR must be a valid number'
        );
      });
    });

    describe('getEnvAsBool', () => {
      it('should return false when value is "false"', () => {
        process.env.BOOL_VAR = 'false';
        expect(getEnvAsBool('BOOL_VAR', true)).toBe(false);
      });

      it('should return false when value is "FALSE"', () => {
        process.env.BOOL_VAR = 'FALSE';
        expect(getEnvAsBool('BOOL_VAR', true)).toBe(false);
      });

      it('should return false when value is "0"', () => {
        process.env.BOOL_VAR = '0';
        expect(getEnvAsBool('BOOL_VAR', true)).toBe(false);
      });

      it('should return true for truthy values', () => {
        process.env.BOOL_VAR = 'true';
        expect(getEnvAsBool('BOOL_VAR', false)).toBe(true);
      });

      it('should return true for "1"', () => {
        process.env.BOOL_VAR = '1';
        expect(getEnvAsBool('BOOL_VAR', false)).toBe(true);
      });

      it('should return default when not set', () => {
        delete process.env.BOOL_VAR;
        expect(getEnvAsBool('BOOL_VAR', true)).toBe(true);
        expect(getEnvAsBool('BOOL_VAR', false)).toBe(false);
      });

      it('should return default when empty string', () => {
        process.env.BOOL_VAR = '';
        expect(getEnvAsBool('BOOL_VAR', true)).toBe(true);
      });
    });
  });
});
