import { getEnv } from '../env-helpers';

/**
 * RateLimitConfig - Rate limiting mode configuration
 *
 * Environment variables:
 * - RATE_LIMIT_MODE: Operating mode - shadow, logging, enforcement (default: 'enforcement')
 */
export class RateLimitConfig {
  readonly mode: 'shadow' | 'logging' | 'enforcement';

  constructor() {
    const mode = getEnv('RATE_LIMIT_MODE', 'enforcement');

    if (mode !== 'shadow' && mode !== 'logging' && mode !== 'enforcement') {
      throw new Error("RATE_LIMIT_MODE must be one of: 'shadow', 'logging', 'enforcement'");
    }

    this.mode = mode;
    this.validate();
  }

  protected validate(): void {
    // Validation already done in constructor
  }
}
