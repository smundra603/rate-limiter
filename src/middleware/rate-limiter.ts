import { NextFunction, Request, Response } from 'express';
import { appConfig } from '../config';
import { getThrottleDecisioner } from '../core/throttle-decisioner';
import { recordRateLimitCheck } from '../metrics/metrics';
import { RateLimitMode } from '../types';
import { asyncHandler } from '../utils/async-handler';
import logger, { logRateLimitDecision } from '../utils/logger';
import { extractIdentity, validateIdentity } from './identity-extractor';

/**
 * Rate limiter middleware for Express
 */
export function rateLimitMiddleware(mode?: RateLimitMode) {
  const rateLimitMode: RateLimitMode = mode || appConfig.rateLimitConfig.mode;

  const decisioner = getThrottleDecisioner();

  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      // Extract request identity
      const identity = extractIdentity(req);

      // Validate identity
      if (!validateIdentity(identity)) {
        logger.warn('Invalid request identity', { identity });
        return next(); // Fail open
      }

      // Perform rate limit check
      const decision = await decisioner.checkRateLimit(identity, rateLimitMode);

      // Calculate latency
      const latencyMs = Date.now() - startTime;

      // Log the decision
      logRateLimitDecision({
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        endpoint: identity.endpoint,
        decision: {
          allowed: decision.allowed,
          state: decision.state,
          scope: decision.scope,
          remaining: decision.remaining,
          limit: decision.limit,
        },
        latency_ms: latencyMs,
        mode: rateLimitMode,
      });

      // Record metrics
      recordRateLimitCheck(
        identity.tenant_id,
        identity.endpoint,
        decision,
        rateLimitMode,
        latencyMs
      );

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', decision.limit.toString());
      res.setHeader('X-RateLimit-Remaining', decision.remaining.toString());
      res.setHeader('X-RateLimit-Reset', decision.reset.toString());
      res.setHeader('X-RateLimit-Mode', rateLimitMode);

      if (decision.retry_after) {
        res.setHeader('Retry-After', decision.retry_after.toString());
      }

      // Add warning header for soft throttle
      if (decision.state === 'soft' && decision.allowed) {
        res.setHeader(
          'X-RateLimit-Warning',
          `Approaching rate limit (${decision.scope}). ${decision.remaining} requests remaining.`
        );
      }

      // Handle throttling based on mode
      if (!decision.allowed) {
        // Request should be throttled
        if (rateLimitMode === 'shadow') {
          // Shadow mode: Allow but log
          res.setHeader('X-RateLimit-Shadow', 'true');
          logger.info('Shadow mode: Would have throttled request', {
            tenant_id: identity.tenant_id,
            user_id: identity.user_id,
            endpoint: identity.endpoint,
            scope: decision.scope,
          });
          return next();
        } else if (rateLimitMode === 'logging') {
          // Logging mode: Allow but add header
          res.setHeader('X-RateLimit-Exceeded', 'true');
          logger.warn('Logging mode: Request exceeded limit but allowed', {
            tenant_id: identity.tenant_id,
            user_id: identity.user_id,
            endpoint: identity.endpoint,
            scope: decision.scope,
          });
          return next();
        } else {
          // Full enforcement mode: Reject
          return res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded for ${decision.scope}`,
            limit: decision.limit,
            remaining: decision.remaining,
            reset: decision.reset,
            retry_after: decision.retry_after,
            scope: decision.scope,
          });
        }
      }

      // Request allowed
      next();
    } catch (error) {
      // Fail open: Allow request on error
      logger.error('Rate limiter error, failing open', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.setHeader('X-RateLimit-Error', 'true');
      next();
    }
  });
}

/**
 * Create rate limiter middleware with custom mode
 */
export function createRateLimiter(mode: RateLimitMode) {
  return rateLimitMiddleware(mode);
}

/**
 * Middleware to skip rate limiting for specific routes
 */
export function skipRateLimiting() {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next();
  };
}
