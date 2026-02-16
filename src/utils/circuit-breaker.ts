import { appConfig } from '../config';
import { recordCircuitBreakerState, recordCircuitBreakerTransition } from '../metrics/metrics';
import { CircuitBreakerState, CircuitBreakerStats } from '../types';
import logger, { logCircuitBreakerStateChange } from './logger';

export interface CircuitBreakerConfig {
  failure_threshold: number; // Number of failures before opening
  timeout_ms: number; // Time to wait before attempting half-open
  success_threshold: number; // Number of successes needed to close from half-open
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private last_failure_time?: number;
  private next_attempt_time = 0;

  constructor(
    private resource_name: string,
    private config: CircuitBreakerConfig
  ) {
    // Initialize circuit breaker state metric
    recordCircuitBreakerState(this.resource_name, this.state);
  }

  /**
   * Execute an operation protected by the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.next_attempt_time) {
        throw new Error(
          `Circuit breaker is OPEN for ${this.resource_name}. Next retry at ${new Date(this.next_attempt_time).toISOString()}`
        );
      }
      // Transition to HALF_OPEN
      this.transitionTo('HALF_OPEN');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.config.success_threshold) {
        this.transitionTo('CLOSED');
        this.successes = 0;
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failures++;
    this.last_failure_time = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      this.successes = 0;
    } else if (this.failures >= this.config.failure_threshold) {
      this.transitionTo('OPEN');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(new_state: CircuitBreakerState): void {
    const old_state = this.state;

    if (old_state === new_state) {
      return;
    }

    this.state = new_state;

    // Record state change in metrics
    recordCircuitBreakerState(this.resource_name, new_state);
    recordCircuitBreakerTransition(this.resource_name, old_state, new_state);

    if (new_state === 'OPEN') {
      this.next_attempt_time = Date.now() + this.config.timeout_ms;
      logCircuitBreakerStateChange(
        this.resource_name,
        old_state,
        new_state,
        `Failure threshold reached: ${this.failures} failures`
      );
    } else if (new_state === 'CLOSED') {
      logCircuitBreakerStateChange(
        this.resource_name,
        old_state,
        new_state,
        `Success threshold reached: ${this.successes} successes`
      );
    } else {
      logCircuitBreakerStateChange(this.resource_name, old_state, new_state, 'Attempting recovery');
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      last_failure_time: this.last_failure_time,
    };
  }

  /**
   * Check if circuit breaker is allowing requests
   */
  isOpen(): boolean {
    return this.state === 'OPEN' && Date.now() < this.next_attempt_time;
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    const old_state = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.last_failure_time = undefined;
    this.next_attempt_time = 0;

    if (old_state !== 'CLOSED') {
      logger.info(`Circuit breaker manually reset for ${this.resource_name}`);
    }
  }
}

/**
 * Create a circuit breaker from environment configuration
 */
export function createCircuitBreaker(resource_name: string): CircuitBreaker {
  // Import config at function level to avoid circular dependencies
  const { circuitBreakerConfig } = appConfig;

  const config: CircuitBreakerConfig = {
    failure_threshold: circuitBreakerConfig.failureThreshold,
    timeout_ms: circuitBreakerConfig.timeoutMs,
    success_threshold: circuitBreakerConfig.successThreshold,
  };

  return new CircuitBreaker(resource_name, config);
}
