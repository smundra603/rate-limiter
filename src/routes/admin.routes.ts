import { Router, Request, Response } from 'express';
import { getOverrideManager } from '../core/override-manager';
import { getAbuseDetectionJob } from '../jobs/abuse-detection-job';
import { OverrideType, TenantOverride } from '../types';
import { asyncHandler } from '../utils/async-handler';
import logger from '../utils/logger';

/**
 * Request body type for creating overrides
 */
interface CreateOverrideRequestBody {
  tenant_id: string;
  user_id?: string;
  endpoint?: string;
  override_type: OverrideType;
  penalty_multiplier?: number;
  custom_rate?: number;
  custom_burst?: number;
  reason: string;
  duration_minutes: number;
}

const router = Router();

const overrideManager = getOverrideManager();
const abuseDetectionJob = getAbuseDetectionJob();

/**
 * GET /admin/overrides
 * List all active overrides
 */
router.get(
  '/overrides',
  asyncHandler(async (_req: Request, res: Response) => {
    const overrides = await overrideManager.listActiveOverrides();

    res.json({
      count: overrides.length,
      overrides,
    });
  })
);

/**
 * POST /admin/overrides
 * Create a new override
 */
router.post(
  '/overrides',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateOverrideRequestBody;
    const {
      tenant_id,
      user_id,
      endpoint,
      override_type,
      penalty_multiplier,
      custom_rate,
      custom_burst,
      reason,
      duration_minutes,
    } = body;

    // Validation
    if (!tenant_id || !override_type || !reason || !duration_minutes) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required fields: tenant_id, override_type, reason, duration_minutes',
      });
      return;
    }

    const validOverrideTypes: OverrideType[] = [
      'penalty_multiplier',
      'temporary_ban',
      'custom_limit',
    ];
    if (!validOverrideTypes.includes(override_type)) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Invalid override_type. Must be one of: ${validOverrideTypes.join(', ')}`,
      });
      return;
    }

    // Validate penalty multiplier
    if (override_type === 'penalty_multiplier' && !penalty_multiplier) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'penalty_multiplier is required for penalty_multiplier type',
      });
      return;
    }

    // Validate custom limit
    if (override_type === 'custom_limit' && (!custom_rate || !custom_burst)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'custom_rate and custom_burst are required for custom_limit type',
      });
      return;
    }

    // Calculate expiry
    const expiresAt = new Date(Date.now() + duration_minutes * 60 * 1000);

    // Create override
    const operatorId = (req.headers['x-operator-id'] as string) || 'unknown';
    const override: Omit<TenantOverride, '_id' | 'created_at'> = {
      tenant_id,
      user_id,
      endpoint,
      override_type,
      penalty_multiplier,
      custom_rate,
      custom_burst,
      reason,
      source: 'manual_operator' as const,
      expires_at: expiresAt,
      metadata: {
        operator_id: operatorId,
      },
    };

    const created = await overrideManager.createOverride(override);

    logger.info('Manual override created', {
      tenant_id,
      override_type,
      duration_minutes,
      operator_id: operatorId,
    });

    res.status(201).json({
      message: 'Override created successfully',
      override: created,
    });
  })
);

/**
 * DELETE /admin/overrides/:id
 * Delete an override by ID
 */
router.delete(
  '/overrides/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const deleted = await overrideManager.deleteOverride(id);

    if (!deleted) {
      res.status(404).json({
        error: 'Not Found',
        message: `Override with ID ${id} not found`,
      });
      return;
    }

    logger.info('Override deleted', { id });

    res.json({
      message: 'Override deleted successfully',
    });
  })
);

/**
 * GET /admin/abuse-detection/status
 * Get abuse detection job status
 */
router.get('/abuse-detection/status', (_req: Request, res: Response) => {
  const status = abuseDetectionJob.getStatus();

  res.json(status);
});

export default router;
