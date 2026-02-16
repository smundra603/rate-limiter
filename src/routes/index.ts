import { Router, Request, Response } from 'express';
import { rateLimitMiddleware, skipRateLimiting } from '../middleware/rate-limiter';
import adminRoutes from './admin.routes';
import apiRoutes from './api.routes';
import healthRoutes from './health.routes';

const router = Router();

/**
 * Health and monitoring routes (no rate limiting)
 */
router.use('/', healthRoutes);

/**
 * Admin routes (no rate limiting)
 */
router.use('/admin', skipRateLimiting(), adminRoutes);

/**
 * API routes (with rate limiting)
 */
router.use('/api', rateLimitMiddleware(), apiRoutes);

/**
 * Catch-all route for 404
 */
router.use('*', (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
  });
});

export default router;
