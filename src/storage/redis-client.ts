import Redis, { Cluster, ClusterOptions } from 'ioredis';
import { appConfig } from '../config';
import {
  BATCH_TOKEN_BUCKET_LUA_SCRIPT,
  SCRIPT_NAMES,
  scriptSHAs,
  TOKEN_BUCKET_LUA_SCRIPT,
} from '../core/lua-scripts';
import { RedisError } from '../types';
import logger from '../utils/logger';

export class RedisClient {
  private client: Redis | Cluster;
  private isCluster: boolean;
  private scriptsLoaded = false;

  constructor() {
    const { redisConfig } = appConfig;

    const commonOptions = {
      password: redisConfig.password,
      connectTimeout: redisConfig.timeoutMs,
      commandTimeout: redisConfig.timeoutMs,
      maxRetriesPerRequest: redisConfig.maxRetries,
      retryStrategy: (times: number) => {
        if (times > 3) {
          return null; // Stop retrying
        }
        return Math.min(times * 50, 200); // Exponential backoff: 50ms, 100ms, 150ms
      },
      enableReadyCheck: true,
      lazyConnect: false,
    };

    // Check for Sentinel configuration first
    if (redisConfig.isSentinel) {
      // Redis Sentinel configuration
      const sentinelNodes = redisConfig.sentinelNodes;

      this.client = new Redis({
        sentinels: sentinelNodes,
        name: redisConfig.masterName,
        ...commonOptions,
        sentinelRetryStrategy: (times: number) => {
          if (times > 3) {
            return null;
          }
          return Math.min(times * 100, 500);
        },
      });

      this.isCluster = false;
      logger.info('Redis Sentinel client initialized', {
        master: redisConfig.masterName,
        sentinels: sentinelNodes,
      });
    } else {
      // Check for Cluster or Standalone
      const clusterNodes = redisConfig.clusterNodes;
      this.isCluster = redisConfig.isCluster;

      if (this.isCluster) {
        // Redis Cluster configuration
        const clusterOptions: ClusterOptions = {
          ...commonOptions,
          clusterRetryStrategy: (times: number) => {
            if (times > 3) {
              return null;
            }
            return Math.min(times * 100, 500);
          },
          enableOfflineQueue: false,
          scaleReads: 'slave', // Read from slaves when possible
          maxRedirections: 16,
        };

        this.client = new Redis.Cluster(
          clusterNodes.map((node: string) => {
            const [host, port] = node.split(':');
            return { host, port: parseInt(port, 10) };
          }),
          clusterOptions
        );

        logger.info('Redis Cluster client initialized', { nodes: clusterNodes });
      } else {
        // Single Redis instance
        const [host, port] = clusterNodes[0].split(':');
        this.client = new Redis({
          host,
          port: parseInt(port, 10),
          ...commonOptions,
        });

        logger.info('Redis client initialized', { host, port });
      }
    }

    // Event handlers
    this.client.on('error', (error: Error) => {
      logger.error('Redis error', { error: error.message, stack: error.stack });
    });

    this.client.on('connect', () => {
      logger.info('Redis connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis ready');
      void this.loadScripts();
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting');
    });
  }

  /**
   * Load Lua scripts into Redis
   * For cluster mode, scripts must be loaded on ALL nodes
   */
  private async loadScripts(): Promise<void> {
    if (this.scriptsLoaded) {
      return;
    }

    try {
      if (this.isCluster && this.client instanceof Cluster) {
        // For cluster mode, load scripts on all master nodes
        const nodes = this.client.nodes('master');
        const loadPromises = nodes.map(async (node) => {
          const tokenBucketSHA = (await node.script('LOAD', TOKEN_BUCKET_LUA_SCRIPT)) as string;
          const batchSHA = (await node.script('LOAD', BATCH_TOKEN_BUCKET_LUA_SCRIPT)) as string;
          return { tokenBucketSHA, batchSHA };
        });

        const results = await Promise.all(loadPromises);
        // All nodes should return the same SHA (scripts are deterministic)
        const { tokenBucketSHA, batchSHA } = results[0];
        scriptSHAs.set(SCRIPT_NAMES.TOKEN_BUCKET, tokenBucketSHA);
        scriptSHAs.set(SCRIPT_NAMES.BATCH_TOKEN_BUCKET, batchSHA);

        logger.info('Lua scripts loaded into all Redis cluster nodes', {
          token_bucket_sha: tokenBucketSHA,
          batch_sha: batchSHA,
          nodes_count: nodes.length,
        });
      } else {
        // For standalone or sentinel mode, load on the single connection
        const tokenBucketSHA = (await this.client.script(
          'LOAD',
          TOKEN_BUCKET_LUA_SCRIPT
        )) as string;
        scriptSHAs.set(SCRIPT_NAMES.TOKEN_BUCKET, tokenBucketSHA);

        const batchSHA = (await this.client.script(
          'LOAD',
          BATCH_TOKEN_BUCKET_LUA_SCRIPT
        )) as string;
        scriptSHAs.set(SCRIPT_NAMES.BATCH_TOKEN_BUCKET, batchSHA);

        logger.info('Lua scripts loaded into Redis', {
          token_bucket_sha: tokenBucketSHA,
          batch_sha: batchSHA,
        });
      }

      this.scriptsLoaded = true;
    } catch (error) {
      logger.error('Failed to load Lua scripts', { error });
      throw new RedisError('Failed to load Lua scripts', error);
    }
  }

  /**
   * Execute token bucket check using Lua script
   */
  async checkTokenBucket(
    key: string,
    capacity: number,
    refillRatePerSec: number,
    softThresholdPct: number,
    hardThresholdPct: number
  ): Promise<{ allowed: boolean; state: number; tokens: number; usagePct: number }> {
    const sha = scriptSHAs.get(SCRIPT_NAMES.TOKEN_BUCKET);

    if (!sha) {
      await this.loadScripts();
      return this.checkTokenBucket(
        key,
        capacity,
        refillRatePerSec,
        softThresholdPct,
        hardThresholdPct
      );
    }

    try {
      const currentTimeMs = Date.now();
      const ttlSeconds = 3600; // 1 hour bucket expiration

      const result = (await this.client.evalsha(
        sha,
        1,
        key,
        capacity.toString(),
        refillRatePerSec.toString(),
        currentTimeMs.toString(),
        softThresholdPct.toString(),
        hardThresholdPct.toString(),
        ttlSeconds.toString()
      )) as [number, number, number, number];

      return {
        allowed: result[0] === 1,
        state: result[1],
        tokens: result[2],
        usagePct: result[3],
      };
    } catch (error) {
      // If script not found, reload and retry once
      if (error instanceof Error && error.message.includes('NOSCRIPT')) {
        scriptSHAs.delete(SCRIPT_NAMES.TOKEN_BUCKET);
        await this.loadScripts();
        return this.checkTokenBucket(
          key,
          capacity,
          refillRatePerSec,
          softThresholdPct,
          hardThresholdPct
        );
      }

      logger.error('Redis token bucket check failed', { key, error });
      throw new RedisError('Token bucket check failed', error);
    }
  }

  /**
   * Execute batch token bucket checks using pipeline
   */
  async batchCheckTokenBuckets(
    checks: Array<{
      key: string;
      capacity: number;
      refillRatePerSec: number;
      softThresholdPct: number;
      hardThresholdPct: number;
    }>
  ): Promise<Array<{ allowed: boolean; state: number; tokens: number; usagePct: number }>> {
    if (checks.length === 0) {
      return [];
    }

    // Use pipeline for parallel execution
    const pipeline = this.client.pipeline();

    for (const check of checks) {
      const sha = scriptSHAs.get(SCRIPT_NAMES.TOKEN_BUCKET);
      const currentTimeMs = Date.now();
      const ttlSeconds = 3600;

      if (!sha) {
        await this.loadScripts();
        return this.batchCheckTokenBuckets(checks);
      }

      pipeline.evalsha(
        sha,
        1,
        check.key,
        check.capacity.toString(),
        check.refillRatePerSec.toString(),
        currentTimeMs.toString(),
        check.softThresholdPct.toString(),
        check.hardThresholdPct.toString(),
        ttlSeconds.toString()
      );
    }

    try {
      const results = await pipeline.exec();

      if (!results) {
        throw new RedisError('Pipeline execution returned null');
      }

      return results.map(([error, result]) => {
        if (error) {
          throw new RedisError('Pipeline command failed', error);
        }

        const [allowed, state, tokens, usagePct] = result as [number, number, number, number];
        return {
          allowed: allowed === 1,
          state,
          tokens,
          usagePct,
        };
      });
    } catch (error) {
      logger.error('Redis batch check failed', { error });
      throw new RedisError('Batch token bucket check failed', error);
    }
  }

  /**
   * Get bucket state without consuming tokens
   */
  async getBucketState(key: string): Promise<{ tokens: number; lastRefillMs: number } | null> {
    try {
      const result = await this.client.hmget(key, 'tokens', 'last_refill_ms');

      if (!result[0] && !result[1]) {
        return null;
      }

      return {
        tokens: parseFloat(result[0] || '0'),
        lastRefillMs: parseInt(result[1] || '0', 10),
      };
    } catch (error) {
      logger.error('Failed to get bucket state', { key, error });
      throw new RedisError('Failed to get bucket state', error);
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis ping failed', { error });
      return false;
    }
  }

  /**
   * Get Redis info
   */
  async getInfo(): Promise<string> {
    try {
      return await this.client.info();
    } catch (error) {
      logger.error('Failed to get Redis info', { error });
      throw new RedisError('Failed to get Redis info', error);
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
    logger.info('Redis connection closed');
  }
}

// Singleton instance
let redisClient: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!redisClient) {
    redisClient = new RedisClient();
  }
  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.close();
    redisClient = null;
  }
}
