import { Request, Response, NextFunction } from 'express';
import { appConfig } from '../config';
import logger from '../utils/logger';

/**
 * Global error handler middleware
 */
export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: appConfig.nodeEnv === 'development' ? error.message : 'An error occurred',
  });
}
