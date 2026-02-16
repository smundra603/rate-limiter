import { appConfig } from '../config';
import { getOverrideManager } from '../core/override-manager';
import { recordAbuseDetectionJobRun, recordAbuseFlag } from '../metrics/metrics';
import { getPrometheusClient } from '../metrics/prometheus-client';
import { OverrideType, TenantOverride } from '../types';
import logger from '../utils/logger';

/**
 * Abuse Detection Job Configuration
 */
interface AbuseDetectionConfig {
  enabled: boolean;
  checkIntervalMs: number;
  throttleThreshold: number;
  detectionWindowMinutes: number;
  penaltyDurationMs: number;
  penaltyType: 'adaptive' | 'fixed';
  penaltyMultiplier: number;
}

/**
 * Abuse Detection Job Status
 */
interface AbuseDetectionStatus {
  enabled: boolean;
  running: boolean;
  lastRunTime?: Date;
  lastRunStatus?: 'success' | 'error';
  config: AbuseDetectionConfig;
}

/**
 * Background job for detecting and mitigating abusive tenants
 */
export class AbuseDetectionJob {
  private config: AbuseDetectionConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunTime?: Date;
  private lastRunStatus?: 'success' | 'error';

  private prometheusClient = getPrometheusClient();
  private overrideManager = getOverrideManager();

  constructor() {
    const { abuseConfig } = appConfig;

    this.config = {
      enabled: abuseConfig.enabled,
      checkIntervalMs: abuseConfig.checkIntervalMs,
      throttleThreshold: abuseConfig.throttleThreshold,
      detectionWindowMinutes: abuseConfig.detectionWindowMinutes,
      penaltyDurationMs: abuseConfig.penaltyDurationMs,
      penaltyType: abuseConfig.penaltyType,
      penaltyMultiplier: abuseConfig.penaltyMultiplier,
    };
  }

  /**
   * Start the background job
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Abuse detection job is disabled');
      return;
    }

    if (this.intervalId) {
      logger.warn('Abuse detection job already running');
      return;
    }

    logger.info('Starting abuse detection job', {
      checkIntervalMs: this.config.checkIntervalMs,
      throttleThreshold: this.config.throttleThreshold,
      detectionWindowMinutes: this.config.detectionWindowMinutes,
      penaltyType: this.config.penaltyType,
      penaltyDurationMs: this.config.penaltyDurationMs,
    });

    // Run immediately
    void this.runDetection();

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      void this.runDetection();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the background job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Abuse detection job stopped');
    }
  }

  /**
   * Run abuse detection logic
   */
  async runDetection(): Promise<void> {
    if (this.running) {
      logger.warn('Abuse detection already running, skipping this iteration');
      return;
    }

    this.running = true;
    this.lastRunTime = new Date();

    try {
      logger.debug('Running abuse detection', {
        threshold: this.config.throttleThreshold,
        windowMinutes: this.config.detectionWindowMinutes,
      });

      // Query Prometheus for tenants with high throttle rate
      const abusiveTenants = await this.prometheusClient.getTenantsWithHighThrottleRate(
        this.config.throttleThreshold,
        this.config.detectionWindowMinutes
      );

      logger.info('Abuse detection scan completed', {
        tenants_found: abusiveTenants.length,
        threshold: this.config.throttleThreshold,
      });

      // Penalize each abusive tenant
      for (const { tenant_id, throttle_rate } of abusiveTenants) {
        await this.penalizeTenant(tenant_id, throttle_rate);
      }

      this.lastRunStatus = 'success';
      recordAbuseDetectionJobRun('success');
    } catch (error) {
      logger.error('Abuse detection job failed', { error });
      this.lastRunStatus = 'error';
      recordAbuseDetectionJobRun('error');
    } finally {
      this.running = false;
    }
  }

  /**
   * Penalize abusive tenant
   */
  private async penalizeTenant(tenant_id: string, throttle_rate: number): Promise<void> {
    try {
      // Check if override already exists (avoid duplicates)
      const hasOverride = await this.overrideManager.hasActiveOverride(tenant_id);

      if (hasOverride) {
        logger.debug('Tenant already has active override, skipping', {
          tenant_id,
          throttle_rate,
        });
        return;
      }

      // Calculate severity
      const severity: 'high' | 'medium' = throttle_rate > 0.8 ? 'high' : 'medium';

      // Create override
      const expiresAt = new Date(Date.now() + this.config.penaltyDurationMs);

      // Map config penaltyType ('adaptive'/'fixed') to database override_type
      const configPenaltyType = this.config.penaltyType;
      const override_type: OverrideType =
        configPenaltyType === 'adaptive' ? 'penalty_multiplier' : 'custom_limit';

      const override: Omit<TenantOverride, '_id' | 'created_at'> = {
        tenant_id,
        override_type,
        reason: `Automatic abuse detection: ${(throttle_rate * 100).toFixed(1)}% throttle rate over ${this.config.detectionWindowMinutes} minutes`,
        source: 'auto_detector' as const,
        expires_at: expiresAt,
        penalty_multiplier:
          configPenaltyType === 'adaptive' ? this.config.penaltyMultiplier : undefined,
        metadata: {
          detection_window: `${this.config.detectionWindowMinutes}m`,
          throttle_rate,
        },
      };

      await this.overrideManager.createOverride(override);

      logger.warn('Abuse penalty applied', {
        tenant_id,
        throttle_rate: `${(throttle_rate * 100).toFixed(1)}%`,
        severity,
        penalty_type: this.config.penaltyType,
        penalty_multiplier: this.config.penaltyMultiplier,
        duration_ms: this.config.penaltyDurationMs,
        expires_at: expiresAt,
      });

      // Record metrics
      recordAbuseFlag(tenant_id, severity);
    } catch (error) {
      logger.error('Failed to penalize tenant', { tenant_id, throttle_rate, error });
    }
  }

  /**
   * Get job status
   */
  getStatus(): AbuseDetectionStatus {
    return {
      enabled: this.config.enabled,
      running: this.running,
      lastRunTime: this.lastRunTime,
      lastRunStatus: this.lastRunStatus,
      config: this.config,
    };
  }
}

// Singleton instance
let abuseDetectionJob: AbuseDetectionJob | null = null;

export function getAbuseDetectionJob(): AbuseDetectionJob {
  if (!abuseDetectionJob) {
    abuseDetectionJob = new AbuseDetectionJob();
  }
  return abuseDetectionJob;
}
