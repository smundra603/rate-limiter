import mongoose from 'mongoose';
import { appConfig } from '../config';
import { MongoDBError } from '../types';
import logger from '../utils/logger';
import { GlobalPolicyModel, TenantOverrideModel, TenantPolicyModel } from './tenant/tenant.schema';

// ==================== MongoDB Client ====================

export class MongoDBClient {
  private connected = false;

  constructor() {}

  /**
   * Connect to MongoDB
   */

  /**
   * Health check
   */
  setConnected(value: boolean) {
    this.connected = value;
  }

  isConnected(): boolean {
    return this.connected && mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  }

  /**
   * Close MongoDB connection
   */
  async close(): Promise<void> {
    await mongoose.connection.close();
    this.connected = false;
    logger.info('MongoDB connection closed');
  }
}

// Singleton instance
let mongoClient: MongoDBClient | null = null;

export function getMongoDBClient(): MongoDBClient {
  if (!mongoClient) {
    mongoClient = new MongoDBClient();
  }
  return mongoClient;
}

export async function closeMongoDBClient(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
  }
}

export async function connectMongoDB(): Promise<void> {
  const { mongoConfig } = appConfig;
  const mongoClient = getMongoDBClient();
  try {
    await mongoose.connect(mongoConfig.uri, {
      maxPoolSize: mongoConfig.poolSize,
      minPoolSize: 2,
      connectTimeoutMS: mongoConfig.connectTimeoutMs,
      serverSelectionTimeoutMS: mongoConfig.connectTimeoutMs,
    });

    mongoClient.setConnected(true);
    logger.info('MongoDB connected', { uri: mongoConfig.sanitizedUri });

    // Create indexes
    await TenantPolicyModel.createIndexes();
    await GlobalPolicyModel.createIndexes();
    await TenantOverrideModel.createIndexes();
    logger.info('MongoDB indexes created');
  } catch (error) {
    logger.error('MongoDB connection failed', { error });
    throw new MongoDBError('Failed to connect to MongoDB', error);
  }

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    mongoClient.setConnected(false);
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
    mongoClient.setConnected(true);
  });
}
// Export models for direct access if needed
