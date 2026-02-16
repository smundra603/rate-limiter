import { requireEnv, getEnvAsInt, getEnv } from '../env-helpers';

/**
 * RedisConfig - Redis connection and cluster configuration
 *
 * Environment variables:
 * - REDIS_CLUSTER_NODES: Comma-separated list of host:port pairs (required)
 * - REDIS_PASSWORD: Redis password (optional)
 * - REDIS_TIMEOUT_MS: Command timeout in milliseconds (default: 100)
 * - REDIS_MAX_RETRIES: Maximum retry attempts (default: 3)
 * - REDIS_POOL_SIZE: Connection pool size (default: 50)
 * - REDIS_SENTINELS: Comma-separated sentinel nodes (optional)
 * - REDIS_MASTER_NAME: Master name for sentinel mode (default: 'mymaster')
 */
export class RedisConfig {
  readonly clusterNodes: string[];
  readonly password: string | undefined;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly poolSize: number;
  readonly sentinels: string | undefined;
  readonly masterName: string;

  constructor() {
    const clusterNodesStr = requireEnv('REDIS_CLUSTER_NODES');
    this.clusterNodes = clusterNodesStr.split(',').map((node) => node.trim());
    this.password = process.env.REDIS_PASSWORD;
    this.timeoutMs = getEnvAsInt('REDIS_TIMEOUT_MS', 100);
    this.maxRetries = getEnvAsInt('REDIS_MAX_RETRIES', 3);
    this.poolSize = getEnvAsInt('REDIS_POOL_SIZE', 50);
    this.sentinels = process.env.REDIS_SENTINELS;
    this.masterName = getEnv('REDIS_MASTER_NAME', 'mymaster');
    this.validate();
  }

  /**
   * Check if Redis is configured in cluster mode
   */
  get isCluster(): boolean {
    return this.clusterNodes.length > 1 && !this.sentinels;
  }

  /**
   * Check if Redis is configured in sentinel mode
   */
  get isSentinel(): boolean {
    return !!this.sentinels;
  }

  /**
   * Parse sentinel nodes into host/port objects
   */
  get sentinelNodes(): Array<{ host: string; port: number }> {
    if (!this.sentinels) {
      return [];
    }

    return this.sentinels.split(',').map((node) => {
      const [host, port] = node.trim().split(':');
      return {
        host,
        port: parseInt(port, 10) || 26379,
      };
    });
  }

  protected validate(): void {
    if (this.clusterNodes.length === 0) {
      throw new Error('REDIS_CLUSTER_NODES must not be empty');
    }

    if (this.timeoutMs < 0) {
      throw new Error('REDIS_TIMEOUT_MS must be >= 0');
    }

    if (this.maxRetries < 0) {
      throw new Error('REDIS_MAX_RETRIES must be >= 0');
    }

    if (this.poolSize < 1) {
      throw new Error('REDIS_POOL_SIZE must be >= 1');
    }
  }
}
