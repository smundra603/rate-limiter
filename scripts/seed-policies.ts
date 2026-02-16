#!/usr/bin/env ts-node

/**
 * Seed MongoDB with test rate limit policies
 * Demonstrates all 6 levels of granularity
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { GlobalPolicyModel, TenantPolicyModel } from '../src/storage/tenant/tenant.schema';
import { GlobalRateLimitPolicy, TenantRateLimitPolicy } from '../src/types';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rate_limiter';

// ==================== Tenant Policies ====================

const tenantPolicies: TenantRateLimitPolicy[] = [
  // FREE TIER - Strict limits (5% buffer)
  {
    tenant_id: 'startup_free',
    tier: 'free',
    policies: {
      // Global user limit (across all endpoints)
      user: { rpm: 100, rps: 2, burst_capacity: 150, refill_rate_per_sec: 100 / 60 },

      // Global tenant limit (across all endpoints)
      tenant: { rpm: 1000, rps: 16, burst_capacity: 1500, refill_rate_per_sec: 1000 / 60 },

      // Per-user endpoint limits
      user_endpoints: {
        '/api/upload': { rpm: 10, rps: 1, burst_capacity: 15, refill_rate_per_sec: 10 / 60 },
        '/api/export': { rpm: 5, rps: 1, burst_capacity: 10, refill_rate_per_sec: 5 / 60 },
      },

      // Per-tenant endpoint limits
      tenant_endpoints: {
        '/api/upload': { rpm: 50, rps: 1, burst_capacity: 75, refill_rate_per_sec: 50 / 60 },
        '/api/search': { rpm: 500, rps: 8, burst_capacity: 750, refill_rate_per_sec: 500 / 60 },
      },

      throttle_config: {
        soft_threshold_pct: 100, // Warnings start at 100% (bucket empty)
        hard_threshold_pct: 105, // Reject at 105% (allowing 5% burst)
        // Buffer: 5% - strict for free tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // PRO TIER - Generous limits (10% buffer)
  {
    tenant_id: 'acme_corp',
    tier: 'pro',
    policies: {
      user: { rpm: 1000, rps: 16, burst_capacity: 2000, refill_rate_per_sec: 1000 / 60 },
      tenant: { rpm: 10000, rps: 166, burst_capacity: 20000, refill_rate_per_sec: 10000 / 60 },

      user_endpoints: {
        '/api/upload': { rpm: 100, rps: 2, burst_capacity: 150, refill_rate_per_sec: 100 / 60 },
        '/api/export': { rpm: 50, rps: 1, burst_capacity: 75, refill_rate_per_sec: 50 / 60 },
      },

      tenant_endpoints: {
        '/api/upload': { rpm: 500, rps: 8, burst_capacity: 750, refill_rate_per_sec: 500 / 60 },
        '/api/search': { rpm: 5000, rps: 83, burst_capacity: 7500, refill_rate_per_sec: 5000 / 60 },
        '/api/analytics': {
          rpm: 2000,
          rps: 33,
          burst_capacity: 3000,
          refill_rate_per_sec: 2000 / 60,
        },
      },

      throttle_config: {
        soft_threshold_pct: 100, // Warnings start at 100%
        hard_threshold_pct: 110, // Reject at 110% (allowing 10% burst)
        // Buffer: 10% - balanced for pro tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // ENTERPRISE TIER - Minimal restrictions (20% buffer)
  {
    tenant_id: 'bigcorp_enterprise',
    tier: 'enterprise',
    policies: {
      user: { rpm: 10000, rps: 166, burst_capacity: 20000, refill_rate_per_sec: 10000 / 60 },
      tenant: { rpm: 100000, rps: 1666, burst_capacity: 200000, refill_rate_per_sec: 100000 / 60 },

      // Only limit very expensive operations
      user_endpoints: {
        '/api/ml/train': { rpm: 10, rps: 1, burst_capacity: 15, refill_rate_per_sec: 10 / 60 },
      },

      tenant_endpoints: {
        '/api/ml/train': { rpm: 100, rps: 2, burst_capacity: 150, refill_rate_per_sec: 100 / 60 },
      },

      throttle_config: {
        soft_threshold_pct: 100, // Warnings start at 100%
        hard_threshold_pct: 120, // Reject at 120% (allowing 20% burst)
        // Buffer: 20% - generous for enterprise tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // CUSTOM TIER - Mixed configuration (10% buffer)
  {
    tenant_id: 'techstartup_custom',
    tier: 'custom',
    policies: {
      // No global user limit
      tenant: { rpm: 5000, rps: 83, burst_capacity: 7500, refill_rate_per_sec: 5000 / 60 },

      // Only endpoint-specific limits
      tenant_endpoints: {
        '/api/upload': { rpm: 200, rps: 3, burst_capacity: 300, refill_rate_per_sec: 200 / 60 },
        '/api/dashboard': {
          rpm: 1000,
          rps: 16,
          burst_capacity: 1500,
          refill_rate_per_sec: 1000 / 60,
        },
      },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 110, // 10% buffer
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // TEST TENANTS
  {
    tenant_id: 'test_tenant_1',
    tier: 'free',
    policies: {
      user: { rpm: 60, rps: 1, burst_capacity: 100, refill_rate_per_sec: 1 },
      tenant: { rpm: 600, rps: 10, burst_capacity: 1000, refill_rate_per_sec: 10 },

      user_endpoints: {
        '/api/upload': { rpm: 5, rps: 1, burst_capacity: 10, refill_rate_per_sec: 5 / 60 },
      },

      tenant_endpoints: {
        '/api/upload': { rpm: 30, rps: 1, burst_capacity: 50, refill_rate_per_sec: 30 / 60 },
      },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 105, // 5% buffer for free tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  {
    tenant_id: 'test_tenant_2',
    tier: 'pro',
    policies: {
      user: { rpm: 500, rps: 8, burst_capacity: 750, refill_rate_per_sec: 500 / 60 },
      tenant: { rpm: 5000, rps: 83, burst_capacity: 7500, refill_rate_per_sec: 5000 / 60 },

      tenant_endpoints: {
        '/api/search': { rpm: 2000, rps: 33, burst_capacity: 3000, refill_rate_per_sec: 2000 / 60 },
      },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 110, // 10% buffer for pro tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  {
    tenant_id: 'demo_tenant',
    tier: 'free',
    policies: {
      user: { rpm: 120, rps: 2, burst_capacity: 180, refill_rate_per_sec: 2 },
      tenant: { rpm: 1200, rps: 20, burst_capacity: 1800, refill_rate_per_sec: 20 },

      user_endpoints: {
        '/api/upload': { rpm: 12, rps: 1, burst_capacity: 20, refill_rate_per_sec: 12 / 60 },
        '/api/export': { rpm: 6, rps: 1, burst_capacity: 10, refill_rate_per_sec: 6 / 60 },
      },

      tenant_endpoints: {
        '/api/upload': { rpm: 60, rps: 1, burst_capacity: 100, refill_rate_per_sec: 1 },
        '/api/search': { rpm: 600, rps: 10, burst_capacity: 900, refill_rate_per_sec: 10 },
      },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 105, // 5% buffer for free tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // High-volume tenant for load testing (20% buffer)
  {
    tenant_id: 'loadtest_tenant',
    tier: 'enterprise',
    policies: {
      user: { rpm: 50000, rps: 833, burst_capacity: 100000, refill_rate_per_sec: 833 },
      tenant: { rpm: 500000, rps: 8333, burst_capacity: 1000000, refill_rate_per_sec: 8333 },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 120, // 20% buffer for enterprise tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // Edge case: Very strict limits
  {
    tenant_id: 'strict_tenant',
    tier: 'free',
    policies: {
      user: { rpm: 10, rps: 1, burst_capacity: 15, refill_rate_per_sec: 10 / 60 },
      tenant: { rpm: 50, rps: 1, burst_capacity: 75, refill_rate_per_sec: 50 / 60 },

      user_endpoints: {
        '/api/export': { rpm: 1, rps: 1, burst_capacity: 2, refill_rate_per_sec: 1 / 60 },
      },

      tenant_endpoints: {
        '/api/export': { rpm: 5, rps: 1, burst_capacity: 10, refill_rate_per_sec: 5 / 60 },
      },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 105, // 5% buffer for free tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // Anonymous/default tenant
  {
    tenant_id: 'anonymous',
    tier: 'free',
    policies: {
      user: { rpm: 30, rps: 1, burst_capacity: 50, refill_rate_per_sec: 30 / 60 },
      tenant: { rpm: 300, rps: 5, burst_capacity: 500, refill_rate_per_sec: 5 },

      throttle_config: {
        soft_threshold_pct: 100,
        hard_threshold_pct: 105, // 5% buffer for free tier
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },

  // Example: Tenant with NO soft throttle (hard limit only)
  // Demonstrates skipping soft throttle behavior
  {
    tenant_id: 'strict_no_soft',
    tier: 'custom',
    policies: {
      user: { rpm: 100, rps: 2, burst_capacity: 150, refill_rate_per_sec: 100 / 60 },
      tenant: { rpm: 1000, rps: 16, burst_capacity: 1500, refill_rate_per_sec: 1000 / 60 },

      throttle_config: {
        // soft_threshold_pct omitted → skip soft throttle
        hard_threshold_pct: 100, // Reject immediately at 100%
        // This creates: normal (0-99%) → hard (≥100%)
        // No soft throttle state or warning headers
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  },
];

// ==================== Global Policy ====================

const globalPolicy: GlobalRateLimitPolicy = {
  _id: 'global_config',
  policies: {
    // Overall system capacity
    global: { rpm: 100000, rps: 1666, burst_capacity: 150000, refill_rate_per_sec: 1666 },

    // Global endpoint limits (protect expensive endpoints system-wide)
    endpoints: {
      '/api/ml/inference': { rpm: 5000, rps: 83, burst_capacity: 6000, refill_rate_per_sec: 83 },
      '/api/video/transcode': { rpm: 1000, rps: 16, burst_capacity: 1200, refill_rate_per_sec: 16 },
      '/api/export': { rpm: 2000, rps: 33, burst_capacity: 3000, refill_rate_per_sec: 33 },
    },
  },
  updated_at: new Date(),
};

// ==================== Seed Function ====================

async function seedPolicies() {
  try {
    console.log('🌱 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing policies
    console.log('🗑️  Clearing existing policies...');
    await TenantPolicyModel.deleteMany({});
    await GlobalPolicyModel.deleteMany({});
    console.log('✅ Existing policies cleared');

    // Insert tenant policies
    console.log('📝 Inserting tenant policies...');
    await TenantPolicyModel.insertMany(tenantPolicies);
    console.log(`✅ Inserted ${tenantPolicies.length} tenant policies`);

    // Insert global policy
    console.log('📝 Inserting global policy...');
    await GlobalPolicyModel.create(globalPolicy);
    console.log('✅ Inserted global policy');

    // Summary
    console.log('\n📊 Summary:');
    console.log(`   - Tenant policies: ${tenantPolicies.length}`);
    console.log(`   - Tiers: ${[...new Set(tenantPolicies.map((p) => p.tier))].join(', ')}`);
    console.log(
      '   - Global endpoints: ' + Object.keys(globalPolicy.policies.endpoints || {}).length
    );

    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n🔍 Test with these tenant IDs:');
    tenantPolicies.forEach((p) => {
      console.log(`   - ${p.tenant_id} (${p.tier})`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  void seedPolicies();
}

export { globalPolicy, seedPolicies, tenantPolicies };
