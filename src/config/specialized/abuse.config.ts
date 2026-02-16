import { getEnvAsBool, getEnvAsInt, getEnvAsFloat, getEnv } from '../env-helpers';

/**
 * AbuseConfig - Abuse detection system configuration
 *
 * Environment variables:
 * - ABUSE_DETECTION_ENABLED: Enable abuse detection (default: true)
 * - ABUSE_CHECK_INTERVAL_MS: How often to check for abuse (default: 60000)
 * - ABUSE_THROTTLE_THRESHOLD: Throttle ratio threshold 0-1 (default: 0.8)
 * - ABUSE_DETECTION_WINDOW_MINUTES: Detection time window (default: 5)
 * - ABUSE_PENALTY_DURATION_MS: Penalty duration in milliseconds (default: 300000)
 * - ABUSE_PENALTY_TYPE: Penalty type - 'fixed' or 'adaptive' (default: 'adaptive')
 * - ABUSE_PENALTY_MULTIPLIER: Rate limit multiplier during penalty 0-1 (default: 0.1)
 */
export class AbuseConfig {
  readonly enabled: boolean;
  readonly checkIntervalMs: number;
  readonly throttleThreshold: number;
  readonly detectionWindowMinutes: number;
  readonly penaltyDurationMs: number;
  readonly penaltyType: 'fixed' | 'adaptive';
  readonly penaltyMultiplier: number;

  constructor() {
    this.enabled = getEnvAsBool('ABUSE_DETECTION_ENABLED', true);
    this.checkIntervalMs = getEnvAsInt('ABUSE_CHECK_INTERVAL_MS', 60000);
    this.throttleThreshold = getEnvAsFloat('ABUSE_THROTTLE_THRESHOLD', 0.8);
    this.detectionWindowMinutes = getEnvAsInt('ABUSE_DETECTION_WINDOW_MINUTES', 5);
    this.penaltyDurationMs = getEnvAsInt('ABUSE_PENALTY_DURATION_MS', 300000);

    const penaltyType = getEnv('ABUSE_PENALTY_TYPE', 'adaptive');
    if (penaltyType !== 'fixed' && penaltyType !== 'adaptive') {
      throw new Error("ABUSE_PENALTY_TYPE must be 'fixed' or 'adaptive'");
    }
    this.penaltyType = penaltyType;

    this.penaltyMultiplier = getEnvAsFloat('ABUSE_PENALTY_MULTIPLIER', 0.1);
    this.validate();
  }

  protected validate(): void {
    if (this.checkIntervalMs <= 0) {
      throw new Error('ABUSE_CHECK_INTERVAL_MS must be greater than 0');
    }

    if (this.throttleThreshold < 0 || this.throttleThreshold > 1) {
      throw new Error('ABUSE_THROTTLE_THRESHOLD must be between 0 and 1');
    }

    if (this.detectionWindowMinutes <= 0) {
      throw new Error('ABUSE_DETECTION_WINDOW_MINUTES must be greater than 0');
    }

    if (this.penaltyDurationMs <= 0) {
      throw new Error('ABUSE_PENALTY_DURATION_MS must be greater than 0');
    }

    if (this.penaltyMultiplier < 0 || this.penaltyMultiplier > 1) {
      throw new Error('ABUSE_PENALTY_MULTIPLIER must be between 0 and 1');
    }
  }
}
