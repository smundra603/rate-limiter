import express from 'express';
import 'express-async-errors';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import routes from './routes';

/**
 * Create and configure Express application
 */
export function createApp(): express.Application {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLogger);

  // Mount all routes
  app.use('/', routes);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
