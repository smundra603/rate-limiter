import { getEnv } from '../env-helpers';

/**
 * LoggingConfig - Application logging configuration
 *
 * Environment variables:
 * - LOG_LEVEL: Logging level - debug, info, warn, error (default: 'info')
 * - LOG_FORMAT: Log format - json or pretty (default: 'json')
 */
export class LoggingConfig {
  readonly level: string;
  readonly format: string;
  private readonly nodeEnv: string;

  constructor() {
    this.level = getEnv('LOG_LEVEL', 'info');
    this.format = getEnv('LOG_FORMAT', 'json');
    this.nodeEnv = getEnv('NODE_ENV', 'development');
    this.validate();
  }

  /**
   * Check if running in production environment
   */
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  protected validate(): void {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(this.level)) {
      throw new Error(`LOG_LEVEL must be one of: ${validLevels.join(', ')}, got: ${this.level}`);
    }

    const validFormats = ['json', 'pretty'];
    if (!validFormats.includes(this.format)) {
      throw new Error(`LOG_FORMAT must be one of: ${validFormats.join(', ')}, got: ${this.format}`);
    }
  }
}
