import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Async handler wrapper for Express routes
 * Catches errors from async functions and passes them to Express error handler
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
