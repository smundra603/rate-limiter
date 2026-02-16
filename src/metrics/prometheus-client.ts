import axios from 'axios';
import logger from '../utils/logger';
import { appConfig } from '../config';

/**
 * Prometheus API response types
 */
interface PrometheusMetric {
  tenant_id?: string;
  [key: string]: string | undefined;
}

interface PrometheusResultItem {
  metric: PrometheusMetric;
  value: [number, string];
}

interface PrometheusQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: PrometheusResultItem[];
  };
  error?: string;
}

/**
 * Prometheus Client
 * Queries Prometheus HTTP API for metrics
 */
export class PrometheusClient {
  private prometheusUrl: string;

  constructor(prometheusUrl?: string) {
    this.prometheusUrl = prometheusUrl || appConfig.metricsConfig.prometheusUrl;
  }

  /**
   * Get throttle rate for a specific tenant over a time window
   * Returns percentage (0-1) of requests that were throttled
   */
  async getTenantThrottleRate(tenant_id: string, windowMinutes: number): Promise<number> {
    try {
      // Query for throttled requests (soft + hard)
      const throttledQuery = `sum(rate(rate_limiter_requests_total{tenant_id="${tenant_id}",result=~"throttled_soft|throttled_hard"}[${windowMinutes}m]))`;

      // Query for total requests
      const totalQuery = `sum(rate(rate_limiter_requests_total{tenant_id="${tenant_id}"}[${windowMinutes}m]))`;

      const [throttledResult, totalResult] = await Promise.all<PrometheusQueryResponse>([
        this.query(throttledQuery),
        this.query(totalQuery),
      ]);

      const throttled = this.extractValue(throttledResult);
      const total = this.extractValue(totalResult);

      if (total === 0) {
        return 0;
      }

      return throttled / total;
    } catch (error) {
      logger.error('Failed to get tenant throttle rate from Prometheus', {
        tenant_id,
        windowMinutes,
        error,
      });
      return 0;
    }
  }

  /**
   * Get all tenants with throttle rate above threshold
   * Returns array of { tenant_id, throttle_rate }
   */
  async getTenantsWithHighThrottleRate(
    threshold: number,
    windowMinutes: number
  ): Promise<Array<{ tenant_id: string; throttle_rate: number }>> {
    try {
      // Query for throttle rate by tenant
      const query = `
        (
          sum by (tenant_id) (rate(rate_limiter_requests_total{result=~"throttled_soft|throttled_hard"}[${windowMinutes}m]))
          /
          sum by (tenant_id) (rate(rate_limiter_requests_total[${windowMinutes}m]))
        ) > ${threshold}
      `.trim();

      const result = await this.query(query);

      if (!result.data || !result.data.result || result.data.result.length === 0) {
        return [];
      }

      return result.data.result.map((item: PrometheusResultItem) => ({
        tenant_id: item.metric.tenant_id || 'unknown',
        throttle_rate: parseFloat(item.value[1]),
      }));
    } catch (error) {
      logger.error('Failed to get tenants with high throttle rate from Prometheus', {
        threshold,
        windowMinutes,
        error,
      });
      return [];
    }
  }

  /**
   * Execute Prometheus query
   */
  private async query(promQuery: string): Promise<PrometheusQueryResponse> {
    const url = `${this.prometheusUrl}/api/v1/query`;

    const response = await axios.get<PrometheusQueryResponse>(url, {
      params: {
        query: promQuery,
      },
      timeout: 5000,
    });

    if (response.data.status !== 'success') {
      throw new Error(`Prometheus query failed: ${response.data.error || 'unknown error'}`);
    }

    return response.data;
  }

  /**
   * Extract scalar value from Prometheus result
   */
  private extractValue(result: PrometheusQueryResponse): number {
    if (!result.data || !result.data.result || result.data.result.length === 0) {
      return 0;
    }

    const value = result.data.result[0].value[1];
    return parseFloat(value) || 0;
  }
}

// Singleton instance
let prometheusClient: PrometheusClient | null = null;

export function getPrometheusClient(): PrometheusClient {
  if (!prometheusClient) {
    prometheusClient = new PrometheusClient();
  }
  return prometheusClient;
}
