import { getEnvAsInt } from '../env-helpers';

/**
 * CircuitBreakerConfig - Circuit breaker configuration
 *
 * Environment variables:
 * - CIRCUIT_BREAKER_FAILURE_THRESHOLD: Number of failures before opening (default: 5)
 * - CIRCUIT_BREAKER_TIMEOUT_MS: Timeout before attempting reset (default: 60000)
 * - CIRCUIT_BREAKER_SUCCESS_THRESHOLD: Successful calls needed to close (default: 2)
 */
export class CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly timeoutMs: number;
  readonly successThreshold: number;

  constructor() {
    this.failureThreshold = getEnvAsInt('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5);
    this.timeoutMs = getEnvAsInt('CIRCUIT_BREAKER_TIMEOUT_MS', 60000);
    this.successThreshold = getEnvAsInt('CIRCUIT_BREAKER_SUCCESS_THRESHOLD', 2);
    this.validate();
  }

  protected validate(): void {
    if (this.failureThreshold <= 0) {
      throw new Error('CIRCUIT_BREAKER_FAILURE_THRESHOLD must be greater than 0');
    }

    if (this.timeoutMs <= 0) {
      throw new Error('CIRCUIT_BREAKER_TIMEOUT_MS must be greater than 0');
    }

    if (this.successThreshold <= 0) {
      throw new Error('CIRCUIT_BREAKER_SUCCESS_THRESHOLD must be greater than 0');
    }
  }
}
