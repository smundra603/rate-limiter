import { getPolicyCache } from '../storage/policy-cache';
import { tenantService } from '../storage/tenant/tenant.service';
import { GlobalRateLimitPolicy, PolicyNotFoundError, TenantRateLimitPolicy } from '../types';
import logger from '../utils/logger';

export class PolicyManager {
  private policyCache = getPolicyCache();
  private changeStreamStarted = false;

  constructor() {
    this.startChangeStream();
  }

  /**
   * Load tenant policy (from cache or MongoDB)
   */
  async loadPolicy(tenant_id: string): Promise<TenantRateLimitPolicy> {
    try {
      const policy = await this.policyCache.getTenantPolicy(tenant_id);

      if (!policy) {
        logger.warn('Tenant policy not found', { tenant_id });
        throw new PolicyNotFoundError(tenant_id);
      }

      return policy;
    } catch (error) {
      if (error instanceof PolicyNotFoundError) {
        throw error;
      }

      logger.error('Failed to load tenant policy', { tenant_id, error });
      throw error;
    }
  }

  /**
   * Load global policy (from cache or MongoDB)
   */
  async getGlobalPolicy(): Promise<GlobalRateLimitPolicy> {
    try {
      const policy = await this.policyCache.getGlobalPolicy();

      if (!policy) {
        logger.warn('Global policy not found, using defaults');
        return this.getDefaultGlobalPolicy();
      }

      return policy;
    } catch (error) {
      logger.error('Failed to load global policy', { error });
      // Return default policy as fallback
      return this.getDefaultGlobalPolicy();
    }
  }

  /**
   * Create or update tenant policy
   */
  async upsertTenantPolicy(policy: TenantRateLimitPolicy): Promise<TenantRateLimitPolicy> {
    try {
      const result = await tenantService.upsertTenantPolicy(policy);

      // Invalidate cache to force reload
      this.policyCache.invalidateTenant(policy.tenant_id);

      logger.info('Tenant policy updated', { tenant_id: policy.tenant_id });
      return result;
    } catch (error) {
      logger.error('Failed to upsert tenant policy', { tenant_id: policy.tenant_id, error });
      throw error;
    }
  }

  /**
   * Create or update global policy
   */
  async upsertGlobalPolicy(policy: GlobalRateLimitPolicy): Promise<GlobalRateLimitPolicy> {
    try {
      const result = await tenantService.upsertGlobalPolicy(policy);

      // Invalidate cache to force reload
      this.policyCache.invalidateGlobal();

      logger.info('Global policy updated');
      return result;
    } catch (error) {
      logger.error('Failed to upsert global policy', { error });
      throw error;
    }
  }

  /**
   * Delete tenant policy
   */
  async deleteTenantPolicy(tenant_id: string): Promise<boolean> {
    try {
      const result = await tenantService.deleteTenantPolicy(tenant_id);

      // Invalidate cache
      this.policyCache.invalidateTenant(tenant_id);

      logger.info('Tenant policy deleted', { tenant_id });
      return result;
    } catch (error) {
      logger.error('Failed to delete tenant policy', { tenant_id, error });
      throw error;
    }
  }

  /**
   * Pre-warm cache with policies for active tenants
   */
  async warmCache(tenant_ids?: string[]): Promise<void> {
    try {
      await this.policyCache.warmCache(tenant_ids);
      logger.info('Policy cache warmed', {
        tenant_count: tenant_ids ? tenant_ids.length : 'all',
      });
    } catch (error) {
      logger.error('Failed to warm cache', { error });
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.policyCache.getStats();
  }

  /**
   * Invalidate specific tenant cache
   */
  invalidateTenantCache(tenant_id: string): void {
    this.policyCache.invalidateTenant(tenant_id);
  }

  /**
   * Invalidate all caches
   */
  invalidateAllCaches(): void {
    this.policyCache.invalidateAll();
    logger.info('All policy caches invalidated');
  }

  /**
   * Start MongoDB change stream for automatic cache invalidation
   */
  private startChangeStream(): void {
    if (this.changeStreamStarted) {
      return;
    }

    try {
      tenantService.watchPolicyChanges((change) => {
        if (change.tenant_id) {
          // Invalidate specific tenant cache
          this.policyCache.invalidateTenant(change.tenant_id);
          logger.debug('Cache invalidated via change stream', {
            tenant_id: change.tenant_id,
            type: change.type,
          });
        } else {
          // Global policy changed or delete operation
          this.policyCache.invalidateGlobal();
          logger.debug('Global cache invalidated via change stream', {
            type: change.type,
          });
        }
      });

      this.changeStreamStarted = true;
      logger.info('MongoDB change stream started for policy cache invalidation');
    } catch (error) {
      // Change streams require replica set, log but don't fail
      logger.warn('Failed to start change stream (requires MongoDB replica set)', { error });
    }
  }

  /**
   * Get default global policy
   */
  private getDefaultGlobalPolicy(): GlobalRateLimitPolicy {
    return {
      _id: 'global_config',
      policies: {
        global: {
          rpm: 100000,
          rps: 1666,
          burst_capacity: 150000,
          refill_rate_per_sec: 1666,
        },
        endpoints: {},
      },
      updated_at: new Date(),
    };
  }

  /**
   * Validate policy configuration
   */
  validatePolicy(policy: TenantRateLimitPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate tenant policy
    if (!policy.tenant_id) {
      errors.push('tenant_id is required');
    }

    if (!policy.policies.tenant) {
      errors.push('tenant policy is required');
    } else {
      if (policy.policies.tenant.rpm <= 0) {
        errors.push('tenant rpm must be positive');
      }
      if (policy.policies.tenant.burst_capacity <= 0) {
        errors.push('tenant burst_capacity must be positive');
      }
    }

    // Validate throttle config
    if (!policy.policies.throttle_config) {
      errors.push('throttle_config is required');
    } else {
      const { soft_threshold_pct, hard_threshold_pct } = policy.policies.throttle_config;

      // Hard threshold is required
      if (hard_threshold_pct === undefined || hard_threshold_pct === null) {
        errors.push('hard_threshold_pct is required');
      } else if (hard_threshold_pct <= 0 || hard_threshold_pct > 200) {
        errors.push('hard_threshold_pct must be between 0 and 200');
      }

      // Soft threshold is optional
      if (soft_threshold_pct !== undefined) {
        if (soft_threshold_pct <= 0 || soft_threshold_pct > 200) {
          errors.push('soft_threshold_pct must be between 0 and 200');
        }

        // If soft is defined, hard must be greater
        if (hard_threshold_pct !== undefined && hard_threshold_pct <= soft_threshold_pct) {
          errors.push('hard_threshold_pct must be greater than soft_threshold_pct');
        }

        // Recommended: warn if buffer is too small
        if (hard_threshold_pct !== undefined) {
          const buffer = hard_threshold_pct - soft_threshold_pct;
          if (buffer < 5) {
            logger.warn('Small soft limit buffer detected', {
              tenant_id: policy.tenant_id,
              soft_threshold_pct,
              hard_threshold_pct,
              buffer_pct: buffer,
              recommendation: 'Buffer should be at least 5% for meaningful soft throttling',
            });
          }
        }
      }
    }

    // Validate user policy if present
    if (policy.policies.user) {
      if (policy.policies.user.rpm > policy.policies.tenant.rpm) {
        errors.push('user rpm cannot exceed tenant rpm');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Singleton instance
let policyManager: PolicyManager | null = null;

export function getPolicyManager(): PolicyManager {
  if (!policyManager) {
    policyManager = new PolicyManager();
  }
  return policyManager;
}
