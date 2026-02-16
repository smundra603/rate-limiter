import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Search endpoint
 * GET /api/search
 * Demo endpoint with high rate limit
 */
router.get('/search', (_req: Request, res: Response) => {
  res.json({
    message: 'Search endpoint (high limit)',
    results: [],
  });
});

/**
 * Upload endpoint
 * POST /api/upload
 * Demo endpoint with low limit (expensive operation)
 */
router.post('/upload', (_req: Request, res: Response) => {
  res.json({
    message: 'Upload endpoint (low limit - expensive operation)',
    file_id: 'demo-' + Date.now(),
  });
});

/**
 * Dashboard endpoint
 * GET /api/dashboard
 * Demo endpoint with medium limit
 */
router.get('/dashboard', (_req: Request, res: Response) => {
  res.json({
    message: 'Dashboard endpoint (medium limit)',
    data: {
      metrics: {},
      charts: [],
    },
  });
});

/**
 * Export endpoint
 * POST /api/export
 * Demo endpoint with very low limit (very expensive operation)
 */
router.post('/export', (_req: Request, res: Response) => {
  res.json({
    message: 'Export endpoint (very low limit - very expensive)',
    export_id: 'export-' + Date.now(),
  });
});

/**
 * ML Inference endpoint
 * GET /api/ml/inference
 * Demo endpoint with global limit
 */
router.get('/ml/inference', (_req: Request, res: Response) => {
  res.json({
    message: 'ML inference endpoint (global limit)',
    prediction: Math.random(),
  });
});

/**
 * Test endpoint
 * GET /api/test
 * General purpose test endpoint
 */
router.get('/test', (_req: Request, res: Response) => {
  res.json({
    message: 'Test endpoint',
    timestamp: new Date().toISOString(),
  });
});

export default router;
