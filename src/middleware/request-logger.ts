import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Request logging middleware
 */
export function requestLogger(req: Request, _res: Response, next: NextFunction) {
  logger.debug('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
}
