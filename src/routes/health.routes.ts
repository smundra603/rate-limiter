import { Router, Request, Response } from 'express';
import { getMetrics } from '../metrics/metrics';
import { skipRateLimiting } from '../middleware/rate-limiter';
import { getMongoDBClient } from '../storage/mongodb-client';
import { getPolicyCache } from '../storage/policy-cache';
import { getRedisClient } from '../storage/redis-client';
import { asyncHandler } from '../utils/async-handler';
import logger from '../utils/logger';

const router = Router();

/**
 * Health check endpoint
 * GET /health
 * Returns overall system health status
 */
router.get(
  '/health',
  skipRateLimiting(),
  asyncHandler(async (_req: Request, res: Response) => {
    const redisClient = getRedisClient();
    const mongoClient = getMongoDBClient();
    const policyCache = getPolicyCache();

    const redisHealthy = await redisClient.ping();
    const mongoHealthy = mongoClient.isConnected();
    const cacheStats = policyCache.getStats();

    const health = {
      status: redisHealthy && mongoHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      components: {
        redis: redisHealthy ? 'up' : 'down',
        mongodb: mongoHealthy ? 'up' : 'down',
        policy_cache: {
          status: 'up',
          size: cacheStats.size,
          hit_ratio: cacheStats.hit_ratio,
        },
      },
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  })
);

/**
 * Metrics endpoint (Prometheus format)
 * GET /metrics
 * Returns Prometheus-formatted metrics
 */
router.get(
  '/metrics',
  skipRateLimiting(),
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const metrics = await getMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } catch (error) {
      logger.error('Failed to get metrics', { error });
      res.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  })
);

/**
 * Readiness probe
 * GET /ready
 * Returns 200 if the service is ready to accept traffic
 */
router.get(
  '/ready',
  skipRateLimiting(),
  asyncHandler(async (_req: Request, res: Response) => {
    const redisClient = getRedisClient();
    const mongoClient = getMongoDBClient();

    const redisReady = await redisClient.ping();
    const mongoReady = mongoClient.isConnected();

    if (redisReady && mongoReady) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({
        status: 'not ready',
        redis: redisReady,
        mongodb: mongoReady,
      });
    }
  })
);

/**
 * Liveness probe
 * GET /live
 * Returns 200 if the service is running
 */
router.get('/live', skipRateLimiting(), (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

export default router;
