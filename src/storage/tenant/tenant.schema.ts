import mongoose, { Model, Schema } from 'mongoose';
import { GlobalRateLimitPolicy, TenantOverride, TenantRateLimitPolicy } from '../../types';

// ==================== Mongoose Schemas ====================

const BucketPolicySchema = new Schema(
  {
    rpm: { type: Number, required: true },
    rps: { type: Number, required: true },
    burst_capacity: { type: Number, required: true },
    refill_rate_per_sec: { type: Number },
  },
  { _id: false }
);

const ThrottleConfigSchema = new Schema(
  {
    soft_threshold_pct: {
      type: Number,
      required: false,
      min: 0,
      max: 200,
    },
    hard_threshold_pct: {
      type: Number,
      required: true,
      min: 0,
      max: 200,
    },
    delay_ms: {
      type: Number,
      required: false,
    },
  },
  { _id: false }
);

const TenantPolicySchema = new Schema<TenantRateLimitPolicy>(
  {
    tenant_id: { type: String, required: true, unique: true },
    tier: {
      type: String,
      enum: ['free', 'pro', 'enterprise', 'custom'],
      required: true,
    },
    policies: {
      user: BucketPolicySchema,
      tenant: { type: BucketPolicySchema, required: true },
      user_endpoints: {
        type: Map,
        of: BucketPolicySchema,
      },
      tenant_endpoints: {
        type: Map,
        of: BucketPolicySchema,
      },
      throttle_config: { type: ThrottleConfigSchema, required: true },
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: 'rate_limit_policies',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

const GlobalPolicySchema = new Schema<GlobalRateLimitPolicy>(
  {
    _id: { type: String, default: 'global_config' },
    policies: {
      global: { type: BucketPolicySchema, required: true },
      endpoints: {
        type: Map,
        of: BucketPolicySchema,
      },
    },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: 'global_policies',
    timestamps: { updatedAt: 'updated_at' },
  }
);

const OverrideSchema = new Schema<TenantOverride>(
  {
    tenant_id: { type: String, required: true, index: true },
    user_id: { type: String, index: true },
    endpoint: { type: String, index: true },
    override_type: {
      type: String,
      required: true,
      enum: ['penalty_multiplier', 'temporary_ban', 'custom_limit'],
    },
    penalty_multiplier: Number,
    custom_rate: Number,
    custom_burst: Number,
    reason: { type: String, required: true },
    source: {
      type: String,
      required: true,
      enum: ['auto_detector', 'manual_operator'],
    },
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true }, // Don't add index: true here
    metadata: Schema.Types.Mixed,
  },
  {
    collection: 'rate_limit_overrides',
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

// TTL index - MongoDB auto-deletes expired overrides
// Define the index only once with TTL option
OverrideSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

// Indexes for performance (tenant_id already has unique index from schema)
TenantPolicySchema.index({ tier: 1 });
TenantPolicySchema.index({ updated_at: -1 });

// ==================== Models ====================

export const TenantPolicyModel: Model<TenantRateLimitPolicy> = mongoose.model(
  'TenantRateLimitPolicy',
  TenantPolicySchema
);

export const GlobalPolicyModel: Model<GlobalRateLimitPolicy> = mongoose.model(
  'GlobalRateLimitPolicy',
  GlobalPolicySchema
);

export const TenantOverrideModel: Model<TenantOverride> = mongoose.model(
  'TenantOverride',
  OverrideSchema
);
