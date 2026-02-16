import { LRUCache } from 'lru-cache';
import { FilterQuery } from 'mongoose';
import { TenantOverrideModel } from '../storage/tenant/tenant.schema';
import { BucketPolicy, TenantOverride } from '../types';
import logger from '../utils/logger';

/**
 * Override Manager
 * Handles CRUD operations for tenant overrides with caching
 */
type CacheValue = { override: TenantOverride | null };

export class OverrideManager {
  private cache: LRUCache<string, CacheValue>;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds

  constructor() {
    this.cache = new LRUCache<string, CacheValue>({
      max: 10000,
      ttl: this.CACHE_TTL_MS,
    });
  }

  /**
   * Get active override for tenant/user/endpoint
   * Returns most specific match (user+endpoint > user > tenant+endpoint > tenant)
   *
   * Performance: Uses single query with $or to fetch all potential matches,
   * then applies priority logic at code level (avoids multiple DB round trips)
   */
  async getActiveOverride(
    tenant_id: string,
    user_id?: string,
    endpoint?: string
  ): Promise<TenantOverride | null> {
    try {
      // Try cache first
      const cacheKey = this.getCacheKey(tenant_id, user_id, endpoint);
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        return cached.override;
      }

      // Query MongoDB for active overrides - single query with $or
      const { baseQuery, orConditions } = this.buildOverrideQuery(tenant_id, user_id, endpoint);

      // Single query to fetch all potential overrides
      const overrides = await TenantOverrideModel.find({
        ...baseQuery,
        $or: orConditions,
      })

        .sort({ created_at: -1 })
        .lean()
        .exec();

      // Apply priority logic at code level (most specific first)
      const override: TenantOverride | null = this.getPriorityOverride(
        overrides,
        user_id,
        endpoint
      );

      // Cache result (including null)
      this.cache.set(cacheKey, { override });

      return override;
    } catch (error) {
      logger.error('Failed to get active override, failing open', {
        tenant_id,
        user_id,
        endpoint,
        error,
      });
      // Fail open - no override applied on error
      return null;
    }
  }

  private getPriorityOverride(
    overrides: TenantOverride[],
    user_id: string | undefined,
    endpoint: string | undefined
  ) {
    let override: TenantOverride | null = null;

    if (overrides.length > 0) {
      // Priority 1: user_id + endpoint
      if (user_id && endpoint) {
        override = overrides.find((o) => o.user_id === user_id && o.endpoint === endpoint) || null;
      }

      // Priority 2: user_id only
      if (!override && user_id) {
        override = overrides.find((o) => o.user_id === user_id && !o.endpoint) || null;
      }

      // Priority 3: endpoint only
      if (!override && endpoint) {
        override = overrides.find((o) => o.endpoint === endpoint && !o.user_id) || null;
      }

      // Priority 4: tenant only
      if (!override) {
        override = overrides.find((o) => !o.user_id && !o.endpoint) || null;
      }
    }
    return override;
  }

  private buildOverrideQuery(
    tenant_id: string,
    user_id: string | undefined,
    endpoint: string | undefined
  ) {
    const now = new Date();

    const baseQuery = {
      tenant_id,
      expires_at: { $gt: now },
    };

    // Build $or conditions for all possible matches
    const orConditions: FilterQuery<TenantOverride>[] = [];

    // Match patterns based on what's provided
    if (user_id && endpoint) {
      orConditions.push({ user_id, endpoint });
    }
    if (user_id) {
      orConditions.push({ user_id, endpoint: { $exists: false } });
    }
    if (endpoint) {
      orConditions.push({ endpoint, user_id: { $exists: false } });
    }
    // Always include tenant-only match
    orConditions.push({ user_id: { $exists: false }, endpoint: { $exists: false } });
    return { baseQuery, orConditions };
  }

  /**
   * Create a new override
   */
  async createOverride(
    override: Omit<TenantOverride, '_id' | 'created_at'>
  ): Promise<TenantOverride> {
    try {
      const newOverride = await TenantOverrideModel.create(override);

      logger.info('Override created', {
        tenant_id: override.tenant_id,
        override_type: override.override_type,
        source: override.source,
        reason: override.reason,
        expires_at: override.expires_at,
      });

      // Invalidate cache
      this.invalidateCache(override.tenant_id, override.user_id, override.endpoint);

      return newOverride.toObject() as TenantOverride;
    } catch (error) {
      logger.error('Failed to create override', { override, error });
      throw error;
    }
  }

  /**
   * Delete override by ID
   */
  async deleteOverride(id: string): Promise<boolean> {
    try {
      const override = await TenantOverrideModel.findById(id).lean().exec();
      if (!override) {
        return false;
      }

      await TenantOverrideModel.deleteOne({ _id: id }).exec();

      logger.info('Override deleted', {
        id,
        tenant_id: override.tenant_id,
        override_type: override.override_type,
      });

      // Invalidate cache
      this.invalidateCache(override.tenant_id, override.user_id, override.endpoint);

      return true;
    } catch (error) {
      logger.error('Failed to delete override', { id, error });
      throw error;
    }
  }

  /**
   * List all active overrides
   */
  async listActiveOverrides(): Promise<TenantOverride[]> {
    try {
      const now = new Date();
      const overrides = await TenantOverrideModel.find({
        expires_at: { $gt: now },
      })
        .sort({ created_at: -1 })
        .lean()
        .exec();

      return overrides as TenantOverride[];
    } catch (error) {
      logger.error('Failed to list overrides', { error });
      throw error;
    }
  }

  /**
   * Check if override already exists for tenant
   */
  async hasActiveOverride(tenant_id: string): Promise<boolean> {
    try {
      const now = new Date();
      const count = await TenantOverrideModel.countDocuments({
        tenant_id,
        expires_at: { $gt: now },
      }).exec();

      return count > 0;
    } catch (error) {
      logger.error('Failed to check active override', { tenant_id, error });
      return false;
    }
  }

  /**
   * Apply override to policy
   * Returns modified policy or null if banned
   */
  applyOverride(
    override: TenantOverride,
    tenantPolicy: BucketPolicy,
    userPolicy?: BucketPolicy
  ): { tenantPolicy: BucketPolicy; userPolicy?: BucketPolicy; banned: boolean } {
    if (override.override_type === 'temporary_ban') {
      // Ban: return banned flag
      return { tenantPolicy, userPolicy, banned: true };
    }

    if (override.override_type === 'penalty_multiplier' && override.penalty_multiplier) {
      // Apply penalty multiplier to both tenant and user policies
      const multiplier = override.penalty_multiplier;

      const modifiedTenantPolicy: BucketPolicy = {
        rpm: Math.floor(tenantPolicy.rpm * multiplier),
        rps: Math.floor(tenantPolicy.rps * multiplier),
        burst_capacity: Math.floor(tenantPolicy.burst_capacity * multiplier),
        refill_rate_per_sec: tenantPolicy.refill_rate_per_sec
          ? tenantPolicy.refill_rate_per_sec * multiplier
          : undefined,
      };

      let modifiedUserPolicy: BucketPolicy | undefined;
      if (userPolicy) {
        modifiedUserPolicy = {
          rpm: Math.floor(userPolicy.rpm * multiplier),
          rps: Math.floor(userPolicy.rps * multiplier),
          burst_capacity: Math.floor(userPolicy.burst_capacity * multiplier),
          refill_rate_per_sec: userPolicy.refill_rate_per_sec
            ? userPolicy.refill_rate_per_sec * multiplier
            : undefined,
        };
      }

      return {
        tenantPolicy: modifiedTenantPolicy,
        userPolicy: modifiedUserPolicy,
        banned: false,
      };
    }

    if (
      override.override_type === 'custom_limit' &&
      override.custom_rate &&
      override.custom_burst
    ) {
      // Apply custom limits
      const customPolicy: BucketPolicy = {
        rpm: override.custom_rate,
        rps: override.custom_rate / 60,
        burst_capacity: override.custom_burst,
        refill_rate_per_sec: override.custom_rate / 60,
      };

      return {
        tenantPolicy: customPolicy,
        userPolicy: customPolicy,
        banned: false,
      };
    }

    // No override applied
    return { tenantPolicy, userPolicy, banned: false };
  }

  /**
   * Generate cache key
   */
  private getCacheKey(tenant_id: string, user_id?: string, endpoint?: string): string {
    return `override:${tenant_id}:${user_id || 'none'}:${endpoint || 'none'}`;
  }

  /**
   * Invalidate cache for tenant/user/endpoint
   */
  private invalidateCache(tenant_id: string, user_id?: string, endpoint?: string): void {
    // Invalidate all possible cache keys
    this.cache.delete(this.getCacheKey(tenant_id, user_id, endpoint));
    this.cache.delete(this.getCacheKey(tenant_id, user_id, undefined));
    this.cache.delete(this.getCacheKey(tenant_id, undefined, endpoint));
    this.cache.delete(this.getCacheKey(tenant_id, undefined, undefined));
  }
}

// Singleton instance
let overrideManager: OverrideManager | null = null;

export function getOverrideManager(): OverrideManager {
  if (!overrideManager) {
    overrideManager = new OverrideManager();
  }
  return overrideManager;
}
