import { LRUCache } from 'lru-cache';
import { appConfig } from '../config';
import { policyCacheHits, policyCacheMisses, recordPolicyCacheMetrics } from '../metrics/metrics';
import { GlobalRateLimitPolicy, TenantRateLimitPolicy } from '../types';
import logger, { logPolicyCacheEvent } from '../utils/logger';
import { tenantService } from './tenant/tenant.service';

export class PolicyCache {
  private tenantCache: LRUCache<string, TenantRateLimitPolicy>;
  private globalCache: GlobalRateLimitPolicy | null = null;
  private globalCacheExpiry = 0;
  private refreshIntervalId?: NodeJS.Timeout;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    private maxSize: number = 10000,
    private ttlMs: number = 60000,
    private refreshIntervalMs: number = 30000
  ) {
    // Initialize LRU cache for tenant policies
    this.tenantCache = new LRUCache<string, TenantRateLimitPolicy>({
      max: maxSize,
      ttl: ttlMs,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });

    logger.info('Policy cache initialized', {
      max_size: maxSize,
      ttl_ms: ttlMs,
      refresh_interval_ms: refreshIntervalMs,
    });

    // Start background refresh
    this.startBackgroundRefresh();
  }

  /**
   * Get tenant policy from cache or MongoDB
   */
  async getTenantPolicy(tenant_id: string): Promise<TenantRateLimitPolicy | null> {
    // Check cache first
    const cached = this.tenantCache.get(tenant_id);

    if (cached) {
      this.cacheHits++;
      policyCacheHits.inc();
      recordPolicyCacheMetrics(this.cacheHits, this.cacheMisses);
      logPolicyCacheEvent('hit', tenant_id);
      return cached;
    }

    // Cache miss - load from MongoDB
    this.cacheMisses++;
    policyCacheMisses.inc();
    recordPolicyCacheMetrics(this.cacheHits, this.cacheMisses);
    logPolicyCacheEvent('miss', tenant_id);

    const policy = await tenantService.getTenantPolicy(tenant_id);

    if (policy) {
      this.tenantCache.set(tenant_id, policy);
    }

    return policy;
  }

  /**
   * Get global policy from cache or MongoDB
   */
  async getGlobalPolicy(): Promise<GlobalRateLimitPolicy | null> {
    const now = Date.now();

    // Check if cache is still valid
    if (this.globalCache && now < this.globalCacheExpiry) {
      return this.globalCache;
    }

    const policy = await tenantService.getGlobalPolicy();

    if (policy) {
      this.globalCache = policy;
      this.globalCacheExpiry = now + this.ttlMs;
    }

    return policy;
  }

  /**
   * Invalidate tenant policy cache
   */
  invalidateTenant(tenant_id: string): void {
    this.tenantCache.delete(tenant_id);
    logger.debug('Tenant policy cache invalidated', { tenant_id });
  }

  /**
   * Invalidate global policy cache
   */
  invalidateGlobal(): void {
    this.globalCache = null;
    this.globalCacheExpiry = 0;
    logger.debug('Global policy cache invalidated');
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    this.tenantCache.clear();
    this.globalCache = null;
    this.globalCacheExpiry = 0;
    logger.info('All policy caches invalidated');
  }

  /**
   * Pre-warm cache with tenant policies
   */
  async warmCache(tenant_ids?: string[]): Promise<void> {
    try {
      if (tenant_ids && tenant_ids.length > 0) {
        // Warm specific tenants
        for (const tenant_id of tenant_ids) {
          const policy = await tenantService.getTenantPolicy(tenant_id);
          if (policy) {
            this.tenantCache.set(tenant_id, policy);
          }
        }
        logger.info('Cache warmed for specific tenants', { count: tenant_ids.length });
      } else {
        // Warm all tenant policies
        const policies = await tenantService.getAllTenantPolicies();
        for (const policy of policies) {
          this.tenantCache.set(policy.tenant_id, policy);
        }
        logger.info('Cache warmed with all tenant policies', { count: policies.length });
      }

      // Warm global policy
      const globalPolicy = await tenantService.getGlobalPolicy();
      if (globalPolicy) {
        this.globalCache = globalPolicy;
        this.globalCacheExpiry = Date.now() + this.ttlMs;
      }
    } catch (error) {
      logger.error('Failed to warm cache', { error });
    }
  }

  /**
   * Start background refresh of active policies
   */
  private startBackgroundRefresh(): void {
    this.refreshIntervalId = setInterval(() => {
      void this.refreshActivePolicies();
    }, this.refreshIntervalMs);

    logger.info('Background policy refresh started');
  }

  /**
   * Refresh policies that are currently in cache
   */
  private async refreshActivePolicies(): Promise<void> {
    try {
      // Get all tenant IDs currently in cache
      const cachedTenantIds: string[] = [];
      for (const key of this.tenantCache.keys()) {
        cachedTenantIds.push(key);
      }

      if (cachedTenantIds.length === 0) {
        return;
      }

      // Refresh each tenant policy
      let refreshed = 0;
      for (const tenant_id of cachedTenantIds) {
        const policy = await tenantService.getTenantPolicy(tenant_id);
        if (policy) {
          this.tenantCache.set(tenant_id, policy);
          refreshed++;
          logPolicyCacheEvent('refresh', tenant_id);
        }
      }

      // Refresh global policy if cached
      if (this.globalCache) {
        const globalPolicy = await tenantService.getGlobalPolicy();
        if (globalPolicy) {
          this.globalCache = globalPolicy;
          this.globalCacheExpiry = Date.now() + this.ttlMs;
        }
      }

      logger.debug('Background refresh completed', {
        tenant_policies_refreshed: refreshed,
        global_policy_refreshed: !!this.globalCache,
      });
    } catch (error) {
      logger.error('Background refresh failed', { error });
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRatio = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    return {
      size: this.tenantCache.size,
      max_size: this.maxSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hit_ratio: hitRatio,
      global_cached: !!this.globalCache,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Stop background refresh and cleanup
   */
  stop(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = undefined;
    }
    this.invalidateAll();
    logger.info('Policy cache stopped');
  }
}

// Singleton instance
let policyCacheInstance: PolicyCache | null = null;

export function getPolicyCache(): PolicyCache {
  if (!policyCacheInstance) {
    const { policyCacheConfig } = appConfig;

    policyCacheInstance = new PolicyCache(
      policyCacheConfig.maxSize,
      policyCacheConfig.ttlMs,
      policyCacheConfig.refreshIntervalMs
    );
  }
  return policyCacheInstance;
}

export function stopPolicyCache(): void {
  if (policyCacheInstance) {
    policyCacheInstance.stop();
    policyCacheInstance = null;
  }
}
