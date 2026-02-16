import { getEnv, getEnvAsInt } from '../env-helpers';

/**
 * MetricsConfig - Metrics and monitoring configuration
 *
 * Environment variables:
 * - PROMETHEUS_URL: Prometheus server URL (default: 'http://localhost:9090')
 * - METRICS_PORT: Port to expose metrics endpoint (default: 9091)
 */
export class MetricsConfig {
  readonly prometheusUrl: string;
  readonly metricsPort: number;

  constructor() {
    this.prometheusUrl = getEnv('PROMETHEUS_URL', 'http://localhost:9090');
    this.metricsPort = getEnvAsInt('METRICS_PORT', 9091);
    this.validate();
  }

  protected validate(): void {
    if (this.metricsPort <= 0 || this.metricsPort > 65535) {
      throw new Error('METRICS_PORT must be between 1 and 65535');
    }

    // Basic URL validation
    try {
      new URL(this.prometheusUrl);
    } catch {
      throw new Error('PROMETHEUS_URL must be a valid URL');
    }
  }
}
