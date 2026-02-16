import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { RequestIdentity } from '../types';
import logger from '../utils/logger';
import { appConfig } from '../config';

interface JWTPayload {
  tenant_id?: string;
  user_id?: string;
  tenantId?: string;
  userId?: string;
  sub?: string;
  [key: string]: unknown;
}

/**
 * Extract request identity from various sources
 */
export function extractIdentity(req: Request): RequestIdentity {
  // Extract endpoint (path without query string)
  const endpoint = req.path;

  // Try to extract from JWT token
  const jwtIdentity = extractFromJWT(req);
  if (jwtIdentity) {
    return {
      ...jwtIdentity,
      endpoint,
      ip_address: getClientIP(req),
    };
  }

  // Try to extract from API key
  const apiKeyIdentity = extractFromAPIKey(req);
  if (apiKeyIdentity) {
    return {
      ...apiKeyIdentity,
      endpoint,
      ip_address: getClientIP(req),
    };
  }

  // Try to extract from custom headers
  const headerIdentity = extractFromHeaders(req);
  if (headerIdentity) {
    return {
      ...headerIdentity,
      endpoint,
      ip_address: getClientIP(req),
    };
  }

  // Fallback to IP-based identification
  const ip = getClientIP(req);
  return {
    tenant_id: 'anonymous',
    user_id: `ip_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`,
    endpoint,
    ip_address: ip,
  };
}

/**
 * Extract identity from JWT token
 */
function extractFromJWT(req: Request): Pick<RequestIdentity, 'tenant_id' | 'user_id'> | null {
  try {
    const { jwtConfig } = appConfig;
    const authHeader = req.headers[jwtConfig.headerLowerCase];

    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }

    // Extract token from "Bearer <token>" format
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    if (!token) {
      return null;
    }

    // Decode JWT (verify if secret is provided)
    let payload: JWTPayload;

    if (jwtConfig.hasSecret) {
      payload = jwt.verify(token, jwtConfig.secret!) as JWTPayload;
    } else {
      // Decode without verification (less secure, but works for demo)
      payload = jwt.decode(token) as JWTPayload;
    }

    if (!payload) {
      return null;
    }

    // Extract tenant_id and user_id from payload
    const tenant_id =
      (typeof payload.tenant_id === 'string' ? payload.tenant_id : null) ||
      (typeof payload.tenantId === 'string' ? payload.tenantId : null) ||
      'default';
    const user_id =
      (typeof payload.user_id === 'string' ? payload.user_id : null) ||
      (typeof payload.userId === 'string' ? payload.userId : null) ||
      (typeof payload.sub === 'string' ? payload.sub : null) ||
      'unknown';

    return { tenant_id, user_id };
  } catch (error) {
    logger.debug('Failed to extract identity from JWT', { error });
    return null;
  }
}

/**
 * Extract identity from API key header
 */
function extractFromAPIKey(req: Request): Pick<RequestIdentity, 'tenant_id' | 'user_id'> | null {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return null;
  }

  // API key format: {tenant_id}.{user_id}.{secret}
  const parts = apiKey.split('.');

  if (parts.length >= 2) {
    return {
      tenant_id: parts[0],
      user_id: parts[1],
    };
  }

  // Simple API key (tenant only)
  return {
    tenant_id: apiKey,
    user_id: 'default',
  };
}

/**
 * Extract identity from custom headers
 */
function extractFromHeaders(req: Request): Pick<RequestIdentity, 'tenant_id' | 'user_id'> | null {
  const tenant_id = req.headers['x-tenant-id'] as string;
  const user_id = req.headers['x-user-id'] as string;

  if (tenant_id && user_id) {
    return { tenant_id, user_id };
  }

  if (tenant_id) {
    return {
      tenant_id,
      user_id: 'default',
    };
  }

  return null;
}

/**
 * Get client IP address from request
 */
function getClientIP(req: Request): string {
  // Check common headers used by proxies
  const forwarded = req.headers['x-forwarded-for'] as string;
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim();
  }

  const realIP = req.headers['x-real-ip'] as string;
  if (realIP) {
    return realIP;
  }

  // Fallback to connection remote address
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Validate identity (used for testing/validation)
 */
export function validateIdentity(identity: RequestIdentity): boolean {
  if (!identity.tenant_id || identity.tenant_id.trim() === '') {
    return false;
  }

  if (!identity.user_id || identity.user_id.trim() === '') {
    return false;
  }

  if (!identity.endpoint || identity.endpoint.trim() === '') {
    return false;
  }

  return true;
}
