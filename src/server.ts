// Load environment variables FIRST - before any other imports
import dotenv from 'dotenv';
dotenv.config();

import * as http from 'http';
import { createApp } from './app';
import { appConfig } from './config';
import { stopFallbackHandler } from './core/fallback-handler';
import { getAbuseDetectionJob } from './jobs/abuse-detection-job';
import { closeMongoDBClient, connectMongoDB } from './storage/mongodb-client';
import { getPolicyCache, stopPolicyCache } from './storage/policy-cache';
import { closeRedisClient } from './storage/redis-client';
import logger from './utils/logger';

const PORT = appConfig.port;

let server: http.Server | null = null;

/**
 * Start the HTTP server
 */
export async function startServer(): Promise<void> {
  try {
    // Initialize connections
    logger.info('Initializing connections...');

    // Warm up policy cache (optional - loads active tenant policies)
    await connectMongoDB();
    getPolicyCache();
    logger.info('Policy cache ready');

    // Start abuse detection job
    const abuseDetectionJob = getAbuseDetectionJob();
    abuseDetectionJob.start();

    // Create Express app
    const app = createApp();

    // Start HTTP server
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info('Rate Limiter server started', {
        port: PORT,
        mode: appConfig.rateLimitConfig.mode,
        node_env: appConfig.nodeEnv,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

/**
 * Get the Express app instance (for testing)
 */
export function getApp() {
  return createApp();
}

/**
 * Gracefully shutdown the server
 */
export async function shutdownServer(): Promise<void> {
  logger.info('Shutting down gracefully...');

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  try {
    // Stop abuse detection job
    const abuseDetectionJob = getAbuseDetectionJob();
    abuseDetectionJob.stop();

    // Close all connections
    await closeRedisClient();
    await closeMongoDBClient();
    stopPolicyCache();
    stopFallbackHandler();

    logger.info('All connections closed');

    // Only exit process if not in test environment
    if (appConfig.nodeEnv !== 'test') {
      process.exit(0);
    }
  } catch (error) {
    logger.error('Error during shutdown', { error });

    // Only exit process if not in test environment
    if (appConfig.nodeEnv !== 'test') {
      process.exit(1);
    } else {
      throw error;
    }
  }
}

/**
 * Setup signal handlers for graceful shutdown
 */
export function setupSignalHandlers(): void {
  // SIGTERM: Kubernetes/Docker graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received');
    void shutdownServer();
  });

  // SIGINT: Ctrl+C in terminal
  process.on('SIGINT', () => {
    logger.info('SIGINT signal received');
    void shutdownServer();
  });

  // Uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    void shutdownServer();
  });

  // Unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    void shutdownServer();
  });
}
