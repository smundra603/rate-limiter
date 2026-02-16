import winston from 'winston';
import { appConfig } from '../config';

const { loggingConfig } = appConfig;
const LOG_LEVEL = loggingConfig.level;
const LOG_FORMAT = loggingConfig.format;

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  LOG_FORMAT === 'json'
    ? winston.format.json()
    : winston.format.printf(({ level, message, timestamp, metadata }) => {
        const meta =
          metadata && typeof metadata === 'object' && Object.keys(metadata).length
            ? JSON.stringify(metadata)
            : '';
        const ts = typeof timestamp === 'string' ? timestamp : '';
        const lvl = typeof level === 'string' ? level.toUpperCase() : 'INFO';
        const msg = typeof message === 'string' ? message : String(message);
        return `${ts} [${lvl}]: ${msg} ${meta}`;
      })
);

// Create the logger instance
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: structuredFormat,
  defaultMeta: { service: 'rate-limiter' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: LOG_FORMAT !== 'json' }),
        structuredFormat
      ),
    }),
  ],
});

// Add file transports in production
if (loggingConfig.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    })
  );
}

/**
 * Helper function to log rate limit decisions
 */
export function logRateLimitDecision(context: {
  tenant_id: string;
  user_id: string;
  endpoint: string;
  decision: {
    allowed: boolean;
    state: string;
    scope: string;
    remaining: number;
    limit: number;
  };
  latency_ms: number;
  mode: string;
}) {
  logger.info('Rate limit check', {
    tenant_id: context.tenant_id,
    user_id: context.user_id,
    endpoint: context.endpoint,
    allowed: context.decision.allowed,
    state: context.decision.state,
    scope: context.decision.scope,
    remaining: context.decision.remaining,
    limit: context.decision.limit,
    latency_ms: context.latency_ms,
    mode: context.mode,
  });
}

/**
 * Helper function to log fallback activations
 */
export function logFallbackActivation(reason: string, details?: unknown) {
  logger.warn('Fallback rate limiter activated', {
    reason,
    details,
    timestamp: Date.now(),
  });
}

/**
 * Helper function to log policy cache events
 */
export function logPolicyCacheEvent(event: 'hit' | 'miss' | 'refresh', tenant_id: string) {
  logger.debug('Policy cache event', {
    event,
    tenant_id,
  });
}

/**
 * Helper function to log circuit breaker state changes
 */
export function logCircuitBreakerStateChange(
  resource: string,
  old_state: string,
  new_state: string,
  reason?: string
) {
  logger.warn('Circuit breaker state changed', {
    resource,
    old_state,
    new_state,
    reason,
    timestamp: Date.now(),
  });
}

export default logger;
