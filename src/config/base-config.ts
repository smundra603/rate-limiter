import { getEnv, requireEnv, getEnvAsInt, getEnvAsFloat, getEnvAsBool } from './env-helpers';

/**
 * BaseConfig - Abstract base class for all configuration classes
 *
 * Provides:
 * - Core Node.js environment variables (NODE_ENV, PORT)
 * - Helper methods for parsing environment variables with type safety
 * - Validation enforcement for all config classes
 */
export abstract class BaseConfig {
  readonly nodeEnv: string;
  readonly port: number;

  constructor() {
    // Use helper functions directly
    this.nodeEnv = getEnv('NODE_ENV', 'development');
    this.port = getEnvAsInt('PORT', 8080);
    this.validate();
  }

  // Keep protected methods as thin wrappers for backward compatibility
  protected getEnv(key: string, defaultValue: string): string {
    return getEnv(key, defaultValue);
  }

  protected requireEnv(key: string): string {
    return requireEnv(key);
  }

  protected getEnvAsInt(key: string, defaultValue: number): number {
    return getEnvAsInt(key, defaultValue);
  }

  protected getEnvAsFloat(key: string, defaultValue: number): number {
    return getEnvAsFloat(key, defaultValue);
  }

  protected getEnvAsBool(key: string, defaultValue: boolean): boolean {
    return getEnvAsBool(key, defaultValue);
  }

  /**
   * Validate configuration values
   * Must be implemented by all subclasses
   */
  protected abstract validate(): void;
}
