import {
  BucketPolicy,
  GlobalRateLimitPolicy,
  MongoDBError,
  TenantRateLimitPolicy,
} from '../../types';
import logger from '../../utils/logger';
import { GlobalPolicyModel, TenantPolicyModel } from './tenant.schema';

class TenantService {
  /**
   * Get tenant policy by tenant_id
   */
  async getTenantPolicy(tenant_id: string): Promise<TenantRateLimitPolicy | null> {
    try {
      const policy = await TenantPolicyModel.findOne({ tenant_id }).lean().exec();
      return policy;
    } catch (error) {
      logger.error('Failed to get tenant policy', { tenant_id, error });
      throw new MongoDBError('Failed to get tenant policy', error);
    }
  }

  /**
   * Get global policy
   */
  async getGlobalPolicy(): Promise<GlobalRateLimitPolicy | null> {
    try {
      const policy = await GlobalPolicyModel.findById('global_config').lean().exec();
      return policy;
    } catch (error) {
      logger.error('Failed to get global policy', { error });
      throw new MongoDBError('Failed to get global policy', error);
    }
  }

  /**
   * Create or update tenant policy
   */
  async upsertTenantPolicy(policy: TenantRateLimitPolicy): Promise<TenantRateLimitPolicy> {
    try {
      // Auto-calculate refill_rate_per_sec if not provided
      const normalizedPolicy = this.normalizePolicy(policy);

      const result = await TenantPolicyModel.findOneAndUpdate(
        { tenant_id: policy.tenant_id },
        normalizedPolicy,
        { upsert: true, new: true, lean: true }
      ).exec();

      if (!result) {
        throw new MongoDBError('Failed to upsert tenant policy: result is null');
      }

      logger.info('Tenant policy upserted', { tenant_id: policy.tenant_id });
      return result as TenantRateLimitPolicy;
    } catch (error) {
      logger.error('Failed to upsert tenant policy', { tenant_id: policy.tenant_id, error });
      throw new MongoDBError('Failed to upsert tenant policy', error);
    }
  }

  /**
   * Create or update global policy
   */
  async upsertGlobalPolicy(policy: GlobalRateLimitPolicy): Promise<GlobalRateLimitPolicy> {
    try {
      // Auto-calculate refill_rate_per_sec
      const normalizedPolicy = this.normalizeGlobalPolicy(policy);

      const result = await GlobalPolicyModel.findByIdAndUpdate('global_config', normalizedPolicy, {
        upsert: true,
        new: true,
        lean: true,
      }).exec();

      if (!result) {
        throw new MongoDBError('Failed to upsert global policy: result is null');
      }

      logger.info('Global policy upserted');
      return result as GlobalRateLimitPolicy;
    } catch (error) {
      logger.error('Failed to upsert global policy', { error });
      throw new MongoDBError('Failed to upsert global policy', error);
    }
  }

  /**
   * Get all tenant policies (for cache warming)
   */
  async getAllTenantPolicies(): Promise<TenantRateLimitPolicy[]> {
    try {
      return await TenantPolicyModel.find().lean().exec();
    } catch (error) {
      logger.error('Failed to get all tenant policies', { error });
      throw new MongoDBError('Failed to get all tenant policies', error);
    }
  }

  /**
   * Delete tenant policy
   */
  async deleteTenantPolicy(tenant_id: string): Promise<boolean> {
    try {
      const result = await TenantPolicyModel.deleteOne({ tenant_id }).exec();
      logger.info('Tenant policy deleted', { tenant_id, deleted: result.deletedCount });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Failed to delete tenant policy', { tenant_id, error });
      throw new MongoDBError('Failed to delete tenant policy', error);
    }
  }

  /**
   * Watch for policy changes (Change Streams)
   */
  watchPolicyChanges(callback: (change: { tenant_id?: string; type: string }) => void): void {
    const changeStream = TenantPolicyModel.watch();

    changeStream.on(
      'change',
      (change: {
        operationType: 'insert' | 'update' | 'delete' | 'replace' | 'invalidate';
        fullDocument?: TenantRateLimitPolicy;
      }) => {
        const operationType = change.operationType;

        if (operationType === 'insert' || operationType === 'update') {
          const tenant_id = change.fullDocument?.tenant_id;
          callback({ tenant_id, type: operationType });
          logger.debug('Policy change detected', { tenant_id, type: operationType });
        } else if (operationType === 'delete') {
          callback({ type: 'delete' });
        }
      }
    );

    changeStream.on('error', (error) => {
      logger.error('Change stream error', { error });
    });

    logger.info('Policy change stream started');
  }

  /**
   * Normalize policy by calculating refill rates
   */
  private normalizePolicy(policy: TenantRateLimitPolicy): TenantRateLimitPolicy {
    const normalized = { ...policy };

    // Calculate user global refill rate
    if (normalized.policies.user && !normalized.policies.user.refill_rate_per_sec) {
      normalized.policies.user.refill_rate_per_sec = normalized.policies.user.rpm / 60;
    }

    // Calculate tenant global refill rate
    if (!normalized.policies.tenant.refill_rate_per_sec) {
      normalized.policies.tenant.refill_rate_per_sec = normalized.policies.tenant.rpm / 60;
    }

    // Calculate user-endpoint refill rates
    if (normalized.policies.user_endpoints) {
      const endpoints = normalized.policies.user_endpoints;
      if (endpoints instanceof Map) {
        endpoints.forEach((bucket: BucketPolicy) => {
          if (!bucket.refill_rate_per_sec) {
            bucket.refill_rate_per_sec = bucket.rpm / 60;
          }
        });
      } else {
        Object.values(endpoints).forEach((bucket: BucketPolicy) => {
          if (!bucket.refill_rate_per_sec) {
            bucket.refill_rate_per_sec = bucket.rpm / 60;
          }
        });
      }
    }

    // Calculate tenant-endpoint refill rates
    if (normalized.policies.tenant_endpoints) {
      const endpoints = normalized.policies.tenant_endpoints;
      if (endpoints instanceof Map) {
        endpoints.forEach((bucket: BucketPolicy) => {
          if (!bucket.refill_rate_per_sec) {
            bucket.refill_rate_per_sec = bucket.rpm / 60;
          }
        });
      } else {
        Object.values(endpoints).forEach((bucket: BucketPolicy) => {
          if (!bucket.refill_rate_per_sec) {
            bucket.refill_rate_per_sec = bucket.rpm / 60;
          }
        });
      }
    }

    return normalized;
  }

  /**
   * Normalize global policy
   */
  private normalizeGlobalPolicy(policy: GlobalRateLimitPolicy): GlobalRateLimitPolicy {
    const normalized = { ...policy };

    // Calculate global refill rate
    if (!normalized.policies.global.refill_rate_per_sec) {
      normalized.policies.global.refill_rate_per_sec = normalized.policies.global.rpm / 60;
    }

    // Calculate endpoint refill rates
    if (normalized.policies.endpoints) {
      const endpoints = normalized.policies.endpoints;
      if (endpoints instanceof Map) {
        endpoints.forEach((bucket: BucketPolicy) => {
          if (!bucket.refill_rate_per_sec) {
            bucket.refill_rate_per_sec = bucket.rpm / 60;
          }
        });
      } else {
        Object.values(endpoints).forEach((bucket: BucketPolicy) => {
          if (!bucket.refill_rate_per_sec) {
            bucket.refill_rate_per_sec = bucket.rpm / 60;
          }
        });
      }
    }

    return normalized;
  }
}

export const tenantService = new TenantService();
