import { requireEnv, getEnvAsInt } from '../env-helpers';

/**
 * MongoConfig - MongoDB connection configuration
 *
 * Environment variables:
 * - MONGODB_URI: MongoDB connection string (required)
 * - MONGO_POOL_SIZE: Connection pool size (default: 10)
 * - MONGO_CONNECT_TIMEOUT_MS: Connection timeout in milliseconds (default: 10000)
 */
export class MongoConfig {
  readonly uri: string;
  readonly poolSize: number;
  readonly connectTimeoutMs: number;

  constructor() {
    this.uri = requireEnv('MONGODB_URI');
    this.poolSize = getEnvAsInt('MONGO_POOL_SIZE', 10);
    this.connectTimeoutMs = getEnvAsInt('MONGO_CONNECT_TIMEOUT_MS', 10000);
    this.validate();
  }

  /**
   * Get sanitized URI with masked credentials for logging
   */
  get sanitizedUri(): string {
    try {
      const url = new URL(this.uri);
      if (url.username || url.password) {
        url.username = '***';
        url.password = '***';
      }
      return url.toString();
    } catch {
      return 'mongodb://***@***/***';
    }
  }

  protected validate(): void {
    if (!this.uri.startsWith('mongodb://') && !this.uri.startsWith('mongodb+srv://')) {
      throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
    }

    if (this.poolSize <= 0) {
      throw new Error('MONGO_POOL_SIZE must be greater than 0');
    }

    if (this.connectTimeoutMs <= 0) {
      throw new Error('MONGO_CONNECT_TIMEOUT_MS must be greater than 0');
    }
  }
}
