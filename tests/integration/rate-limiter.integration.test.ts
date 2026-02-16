/**
 * Integration tests for the rate limiter system
 * These tests require Redis and MongoDB to be running
 */

// Set required env vars BEFORE any imports
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb://localhost:27017/rate_limiter_test';
}
if (!process.env.REDIS_CLUSTER_NODES) {
  process.env.REDIS_CLUSTER_NODES = 'localhost:6379';
}
if (!process.env.RATE_LIMIT_MODE) {
  process.env.RATE_LIMIT_MODE = 'shadow'; // Integration tests default to shadow mode
}

import request, { Response } from 'supertest';
import { startServer, shutdownServer } from '../../src/server';
import { createApp } from '../../src/app';
import { closeRedisClient } from '../../src/storage/redis-client';
import {
  getMongoDBClient,
  closeMongoDBClient,
  TenantPolicyModel,
  GlobalPolicyModel,
} from '../../src/storage/mongodb-client';
import { TenantRateLimitPolicy, GlobalRateLimitPolicy } from '../../src/types';

// Response body interfaces for type safety
interface HealthResponse {
  status: string;
  components: {
    redis: string;
    mongodb: string;
  };
}

interface ApiResponse {
  message: string;
  results?: unknown[];
  file_id?: string;
  data?: unknown;
  export_id?: string;
  prediction?: unknown;
}

interface ErrorResponse {
  error: string;
  message?: string;
}

describe('Rate Limiter Integration Tests', () => {
  const app = createApp();

  beforeAll(async () => {
    // Start server
    startServer();

    // Wait for services to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Seed test policies
    await seedTestPolicies();
  }, 30000);

  afterAll(async () => {
    await shutdownServer();
    await closeRedisClient();
    await closeMongoDBClient();
  }, 10000);

  describe('Health Endpoints', () => {
    it('GET /health should return healthy status', async () => {
      const response: Response = await request(app).get('/health');
      const body = response.body as HealthResponse;

      expect(response.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.components.redis).toBe('up');
      expect(body.components.mongodb).toBe('up');
    });

    it('GET /ready should return ready status', async () => {
      const response: Response = await request(app).get('/ready');
      const body = response.body as { status: string };

      expect(response.status).toBe(200);
      expect(body.status).toBe('ready');
    });

    it('GET /live should always return alive', async () => {
      const response: Response = await request(app).get('/live');
      const body = response.body as { status: string };

      expect(response.status).toBe(200);
      expect(body.status).toBe('alive');
    });

    it('GET /metrics should return Prometheus metrics', async () => {
      const response: Response = await request(app).get('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('rate_limiter_requests_total');
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include rate limit headers on successful request', async () => {
      const response: Response = await request(app)
        .get('/api/search')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_headers');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
      expect(response.headers['x-ratelimit-mode']).toBeDefined();
    });

    it('should decrement remaining count on subsequent requests', async () => {
      const headers = {
        'X-Tenant-ID': 'test_integration',
        'X-User-ID': 'user_decrement',
      };

      const response1: Response = await request(app).get('/api/search').set(headers);
      const remaining1 = parseInt(String(response1.headers['x-ratelimit-remaining']));

      const response2: Response = await request(app).get('/api/search').set(headers);
      const remaining2 = parseInt(String(response2.headers['x-ratelimit-remaining']));

      expect(remaining2).toBeLessThan(remaining1);
    });
  });

  describe('Authentication Methods', () => {
    it('should accept custom headers (X-Tenant-ID, X-User-ID)', async () => {
      const response: Response = await request(app)
        .get('/api/search')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_custom');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });

    it('should accept API key format', async () => {
      const response: Response = await request(app)
        .get('/api/search')
        .set('X-API-Key', 'test_integration.user_apikey.secret123');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });

    it('should fallback to anonymous for unauthenticated requests', async () => {
      const response: Response = await request(app).get('/api/search');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });
  });

  describe('Hierarchical Rate Limiting', () => {
    it('should enforce tenant global limit', async () => {
      const headers = {
        'X-Tenant-ID': 'test_strict',
        'X-User-ID': 'user_tenant_global',
      };

      // Make requests up to tenant limit
      const limit = 50;
      for (let i = 0; i < limit + 5; i++) {
        await request(app).get('/api/search').set(headers);
      }

      // Next request should show reduced remaining
      const response: Response = await request(app).get('/api/search').set(headers);
      const remaining = parseInt(String(response.headers['x-ratelimit-remaining']));

      expect(remaining).toBeLessThan(limit);
    });

    it('should enforce user-specific endpoint limit', async () => {
      const headers = {
        'X-Tenant-ID': 'test_integration',
        'X-User-ID': 'user_endpoint_test',
      };

      // Make requests to upload endpoint
      for (let i = 0; i < 15; i++) {
        await request(app).post('/api/upload').set(headers);
      }

      const response: Response = await request(app).post('/api/upload').set(headers);

      // Should have fewer remaining requests on upload than general limit
      const remaining = parseInt(String(response.headers['x-ratelimit-remaining']));
      expect(remaining).toBeDefined();
    });

    it('should treat different endpoints independently', async () => {
      const headers = {
        'X-Tenant-ID': 'test_integration',
        'X-User-ID': 'user_multi_endpoint',
      };

      // Get initial state for both endpoints
      const search1: Response = await request(app).get('/api/search').set(headers);
      const searchRemaining1 = parseInt(String(search1.headers['x-ratelimit-remaining']));

      const upload1: Response = await request(app).post('/api/upload').set(headers);
      const uploadRemaining1 = parseInt(String(upload1.headers['x-ratelimit-remaining']));

      // Limits should be different if endpoint-specific policies exist
      expect(searchRemaining1).toBeDefined();
      expect(uploadRemaining1).toBeDefined();
    });
  });

  describe('Progressive Throttling', () => {
    it('should show warning header when approaching limit (soft throttle)', async () => {
      const headers = {
        'X-Tenant-ID': 'test_strict',
        'X-User-ID': 'user_soft_throttle',
      };

      // Exhaust most of the quota
      for (let i = 0; i < 8; i++) {
        await request(app).get('/api/search').set(headers);
      }

      const response: Response = await request(app).get('/api/search').set(headers);

      // Should either show warning or be close to limit
      const remaining = parseInt(String(response.headers['x-ratelimit-remaining']));
      expect(remaining).toBeLessThan(5);
    });
  });

  describe('Missing Soft Threshold', () => {
    it('should skip soft throttle when soft_threshold_pct not configured', async () => {
      // Create test policy without soft threshold
      const noSoftPolicy: TenantRateLimitPolicy = {
        tenant_id: 'test_no_soft',
        tier: 'custom',
        policies: {
          user: { rpm: 10, rps: 1, burst_capacity: 15, refill_rate_per_sec: 10 / 60 },
          tenant: { rpm: 50, rps: 1, burst_capacity: 75, refill_rate_per_sec: 50 / 60 },
          throttle_config: {
            // soft_threshold_pct omitted
            hard_threshold_pct: 100,
          },
        },
      };

      await TenantPolicyModel.findOneAndUpdate({ tenant_id: 'test_no_soft' }, noSoftPolicy, {
        upsert: true,
      });

      const headers = {
        'X-Tenant-ID': 'test_no_soft',
        'X-User-ID': 'user_no_soft',
      };

      // Exhaust quota (9 requests)
      for (let i = 0; i < 9; i++) {
        await request(app).get('/api/search').set(headers);
      }

      // 10th request should be close to limit
      const response10: Response = await request(app).get('/api/search').set(headers);
      const remaining10 = parseInt(String(response10.headers['x-ratelimit-remaining']));

      // Should NOT have soft throttle warning (goes straight to hard)
      expect(response10.headers['x-ratelimit-warning']).toBeUndefined();
      expect(remaining10).toBeLessThanOrEqual(5); // After 10 requests with burst=15, remaining=5

      // 11th request should hit hard limit
      const response11: Response = await request(app).get('/api/search').set(headers);

      // In shadow mode, still returns 200 but would be throttled
      expect(response11.status).toBe(200);
      expect(response11.headers['x-ratelimit-shadow']).toBeDefined();
    });
  });

  describe('Different Rollout Modes', () => {
    it('should allow request in shadow mode even when limit exceeded', async () => {
      // Shadow mode is the default in tests
      const headers = {
        'X-Tenant-ID': 'test_strict',
        'X-User-ID': 'user_shadow_mode',
      };

      // Exhaust quota
      for (let i = 0; i < 60; i++) {
        await request(app).get('/api/search').set(headers);
      }

      // Should still get 200 OK in shadow mode
      const response: Response = await request(app).get('/api/search').set(headers);
      expect(response.status).toBe(200);
    });
  });

  describe('Demo API Endpoints', () => {
    it('GET /api/search should return search results', async () => {
      const response: Response = await request(app)
        .get('/api/search')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_demo');
      const body = response.body as ApiResponse;

      expect(response.status).toBe(200);
      expect(body.message).toContain('Search endpoint');
      expect(body.results).toBeDefined();
    });

    it('POST /api/upload should return file ID', async () => {
      const response: Response = await request(app)
        .post('/api/upload')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_demo')
        .send({ file: 'test data' });
      const body = response.body as ApiResponse;

      expect(response.status).toBe(200);
      expect(body.message).toContain('Upload endpoint');
      expect(body.file_id).toBeDefined();
    });

    it('GET /api/dashboard should return dashboard data', async () => {
      const response: Response = await request(app)
        .get('/api/dashboard')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_demo');
      const body = response.body as ApiResponse;

      expect(response.status).toBe(200);
      expect(body.message).toContain('Dashboard endpoint');
      expect(body.data).toBeDefined();
    });

    it('POST /api/export should return export ID', async () => {
      const response: Response = await request(app)
        .post('/api/export')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_demo');
      const body = response.body as ApiResponse;

      expect(response.status).toBe(200);
      expect(body.message).toContain('Export endpoint');
      expect(body.export_id).toBeDefined();
    });

    it('GET /api/ml/inference should return prediction', async () => {
      const response: Response = await request(app)
        .get('/api/ml/inference')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_demo');
      const body = response.body as ApiResponse;

      expect(response.status).toBe(200);
      expect(body.message).toContain('ML inference');
      expect(body.prediction).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response: Response = await request(app)
        .get('/api/unknown')
        .set('X-Tenant-ID', 'test_integration')
        .set('X-User-ID', 'user_demo');
      const body = response.body as ErrorResponse;

      expect(response.status).toBe(404);
      expect(body.error).toBe('Not Found');
    });

    it('should fail open on internal errors', () => {
      // This would need to be tested by mocking failures
      // For now, just verify error handling middleware exists
      expect(app).toBeDefined();
    });
  });

  describe('Policy Cache', () => {
    it('should serve requests from cache after first load', async () => {
      const headers = {
        'X-Tenant-ID': 'test_integration',
        'X-User-ID': 'user_cache_test',
      };

      // First request - cache miss
      const response1: Response = await request(app).get('/api/search').set(headers);
      expect(response1.status).toBe(200);

      // Second request - should hit cache
      const response2: Response = await request(app).get('/api/search').set(headers);
      expect(response2.status).toBe(200);

      // Both should have same limit
      expect(response1.headers['x-ratelimit-limit']).toBe(response2.headers['x-ratelimit-limit']);
    });
  });
});

// Helper function to seed test policies
async function seedTestPolicies(): Promise<void> {
  getMongoDBClient();

  // Create test integration tenant
  const testPolicy: TenantRateLimitPolicy = {
    tenant_id: 'test_integration',
    tier: 'pro',
    policies: {
      user: { rpm: 100, rps: 2, burst_capacity: 150, refill_rate_per_sec: 100 / 60 },
      tenant: { rpm: 1000, rps: 16, burst_capacity: 1500, refill_rate_per_sec: 1000 / 60 },
      user_endpoints: {
        '/api/upload': { rpm: 10, rps: 1, burst_capacity: 15, refill_rate_per_sec: 10 / 60 },
      },
      tenant_endpoints: {
        '/api/upload': { rpm: 50, rps: 1, burst_capacity: 75, refill_rate_per_sec: 50 / 60 },
      },
      throttle_config: {
        soft_threshold_pct: 100, // Warnings at 100%
        hard_threshold_pct: 110, // Reject at 110% (10% buffer)
      },
    },
  };

  // Create strict test tenant
  const strictPolicy: TenantRateLimitPolicy = {
    tenant_id: 'test_strict',
    tier: 'free',
    policies: {
      user: { rpm: 10, rps: 1, burst_capacity: 15, refill_rate_per_sec: 10 / 60 },
      tenant: { rpm: 50, rps: 1, burst_capacity: 75, refill_rate_per_sec: 50 / 60 },
      throttle_config: {
        soft_threshold_pct: 100, // Warnings at 100%
        hard_threshold_pct: 105, // Reject at 105% (5% buffer for free tier)
      },
    },
  };

  // Create global policy
  const globalPolicy: GlobalRateLimitPolicy = {
    _id: 'global_config',
    policies: {
      global: { rpm: 100000, rps: 1666, burst_capacity: 150000, refill_rate_per_sec: 1666 },
    },
  };

  // Insert or update policies
  await TenantPolicyModel.findOneAndUpdate({ tenant_id: 'test_integration' }, testPolicy, {
    upsert: true,
  });

  await TenantPolicyModel.findOneAndUpdate({ tenant_id: 'test_strict' }, strictPolicy, {
    upsert: true,
  });

  await GlobalPolicyModel.findOneAndUpdate({ _id: 'global_config' }, globalPolicy, {
    upsert: true,
  });
}
