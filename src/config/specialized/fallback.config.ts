import { getEnvAsInt } from '../env-helpers';

/**
 * FallbackConfig - Fallback rate limiting configuration
 *
 * Environment variables:
 * - FALLBACK_RPM: Requests per minute in fallback mode (default: 60)
 * - FALLBACK_BURST_CAPACITY: Burst capacity in fallback mode (default: 10)
 */
export class FallbackConfig {
  readonly rpm: number;
  readonly burstCapacity: number;

  constructor() {
    this.rpm = getEnvAsInt('FALLBACK_RPM', 60);
    this.burstCapacity = getEnvAsInt('FALLBACK_BURST_CAPACITY', 10);
    this.validate();
  }

  protected validate(): void {
    if (this.rpm <= 0) {
      throw new Error('FALLBACK_RPM must be greater than 0');
    }

    if (this.burstCapacity <= 0) {
      throw new Error('FALLBACK_BURST_CAPACITY must be greater than 0');
    }
  }
}
