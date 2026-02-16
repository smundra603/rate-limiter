#!/usr/bin/env ts-node

/**
 * Test client for rate limiter
 * Makes requests and observes rate limit headers
 */

import http from 'http';
import jwt from 'jsonwebtoken';

interface TestConfig {
  host: string;
  port: number;
  tenant_id: string;
  user_id: string;
  endpoint: string;
  num_requests: number;
  delay_ms: number;
  use_jwt: boolean;
  method: 'GET' | 'POST';
}

interface RateLimitHeaders {
  limit?: string;
  remaining?: string;
  reset?: string;
  mode?: string;
  warning?: string;
  retry_after?: string;
  exceeded?: string;
  shadow?: string;
}

async function makeRequest(config: TestConfig): Promise<{
  status: number;
  headers: RateLimitHeaders;
  body: any;
}> {
  return new Promise((resolve, reject) => {
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (config.use_jwt) {
      // Generate JWT token
      const token = jwt.sign(
        {
          tenant_id: config.tenant_id,
          user_id: config.user_id,
        },
        'test-secret',
        { expiresIn: '1h' }
      );
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Use custom headers
      headers['X-Tenant-ID'] = config.tenant_id;
      headers['X-User-ID'] = config.user_id;
    }

    const options = {
      hostname: config.host,
      port: config.port,
      path: config.endpoint,
      method: config.method,
      headers,
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        const rateLimitHeaders: RateLimitHeaders = {
          limit: res.headers['x-ratelimit-limit'] as string,
          remaining: res.headers['x-ratelimit-remaining'] as string,
          reset: res.headers['x-ratelimit-reset'] as string,
          mode: res.headers['x-ratelimit-mode'] as string,
          warning: res.headers['x-ratelimit-warning'] as string,
          retry_after: res.headers['retry-after'] as string,
          exceeded: res.headers['x-ratelimit-exceeded'] as string,
          shadow: res.headers['x-ratelimit-shadow'] as string,
        };

        try {
          resolve({
            status: res.statusCode || 0,
            headers: rateLimitHeaders,
            body: body ? JSON.parse(body) : null,
          });
        } catch {
          resolve({
            status: res.statusCode || 0,
            headers: rateLimitHeaders,
            body: body,
          });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function displayResponse(
  requestNum: number,
  response: { status: number; headers: RateLimitHeaders; body: any }
) {
  const { status, headers } = response;

  // Color codes
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const red = '\x1b[31m';
  const blue = '\x1b[34m';
  const reset = '\x1b[0m';

  let statusColor = green;
  if (status === 429) statusColor = red;
  else if (headers.warning) statusColor = yellow;

  console.log(`\n${blue}Request #${requestNum}${reset}`);
  console.log(`  Status: ${statusColor}${status}${reset}`);
  console.log(`  Limit: ${headers.limit || 'N/A'}`);
  console.log(`  Remaining: ${headers.remaining || 'N/A'}`);

  if (headers.reset) {
    const resetDate = new Date(parseInt(headers.reset) * 1000);
    console.log(`  Reset: ${resetDate.toLocaleTimeString()}`);
  }

  if (headers.mode) {
    console.log(`  Mode: ${headers.mode}`);
  }

  if (headers.warning) {
    console.log(`  ${yellow}⚠ Warning: ${headers.warning}${reset}`);
  }

  if (headers.retry_after) {
    console.log(`  ${red}⏱ Retry After: ${headers.retry_after}s${reset}`);
  }

  if (headers.exceeded) {
    console.log(`  ${yellow}⚠ Exceeded (logging mode)${reset}`);
  }

  if (headers.shadow) {
    console.log(`  ${blue}ℹ Shadow mode: Would have throttled${reset}`);
  }

  // Show usage percentage
  if (headers.limit && headers.remaining) {
    const limit = parseInt(headers.limit);
    const remaining = parseInt(headers.remaining);
    const used = limit - remaining;
    const usagePct = ((used / limit) * 100).toFixed(1);
    console.log(`  Usage: ${used}/${limit} (${usagePct}%)`);
  }
}

async function runTest(config: TestConfig) {
  console.log('🚀 Starting rate limiter test...\n');
  console.log('Configuration:');
  console.log(`  Host: ${config.host}:${config.port}`);
  console.log(`  Tenant: ${config.tenant_id}`);
  console.log(`  User: ${config.user_id}`);
  console.log(`  Endpoint: ${config.endpoint}`);
  console.log(`  Requests: ${config.num_requests}`);
  console.log(`  Delay: ${config.delay_ms}ms`);
  console.log(`  Auth: ${config.use_jwt ? 'JWT' : 'Headers'}`);

  let throttledCount = 0;
  let softThrottleCount = 0;

  for (let i = 1; i <= config.num_requests; i++) {
    try {
      const response = await makeRequest(config);
      displayResponse(i, response);

      if (response.status === 429) {
        throttledCount++;
      }

      if (response.headers.warning) {
        softThrottleCount++;
      }

      // Wait before next request
      if (i < config.num_requests && config.delay_ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.delay_ms));
      }
    } catch (error) {
      console.error(`\n❌ Request #${i} failed:`, error);
    }
  }

  // Summary
  console.log('\n\n📊 Test Summary:');
  console.log(`  Total Requests: ${config.num_requests}`);
  console.log(`  Throttled (429): ${throttledCount}`);
  console.log(`  Soft Throttle: ${softThrottleCount}`);
  console.log(`  Success Rate: ${(((config.num_requests - throttledCount) / config.num_requests) * 100).toFixed(1)}%`);
}

// ==================== CLI Interface ====================

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = {
    host: 'localhost',
    port: 8080,
    tenant_id: 'demo_tenant',
    user_id: 'user_123',
    endpoint: '/api/search',
    num_requests: 10,
    delay_ms: 100,
    use_jwt: false,
    method: 'GET',
  };

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];

    switch (key) {
      case '--host':
        config.host = value;
        break;
      case '--port':
        config.port = parseInt(value, 10);
        break;
      case '--tenant':
        config.tenant_id = value;
        break;
      case '--user':
        config.user_id = value;
        break;
      case '--endpoint':
        config.endpoint = value;
        break;
      case '--requests':
      case '-n':
        config.num_requests = parseInt(value, 10);
        break;
      case '--delay':
      case '-d':
        config.delay_ms = parseInt(value, 10);
        break;
      case '--jwt':
        config.use_jwt = value === 'true';
        i--; // No value for boolean flag
        break;
      case '--method':
      case '-m':
        config.method = value.toUpperCase() as 'GET' | 'POST';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  // Auto-detect POST method for upload/export endpoints
  if (config.endpoint.includes('/upload') || config.endpoint.includes('/export')) {
    if (!args.includes('--method') && !args.includes('-m')) {
      config.method = 'POST';
    }
  }

  return config;
}

function printHelp() {
  console.log(`
Rate Limiter Test Client

Usage:
  npm run test:client [options]

Options:
  --host <host>          Host (default: localhost)
  --port <port>          Port (default: 8080)
  --tenant <id>          Tenant ID (default: demo_tenant)
  --user <id>            User ID (default: user_123)
  --endpoint <path>      Endpoint path (default: /api/search)
  -m, --method <method>  HTTP method: GET or POST (auto-detected for upload/export)
  -n, --requests <num>   Number of requests (default: 10)
  -d, --delay <ms>       Delay between requests in ms (default: 100)
  --jwt                  Use JWT authentication (default: false)
  -h, --help             Show this help

Examples:
  # Basic test
  npm run test:client

  # Test with specific tenant
  npm run test:client --tenant startup_free --requests 20

  # Burst test (no delay)
  npm run test:client --tenant demo_tenant --requests 50 --delay 0

  # Test upload endpoint
  npm run test:client --endpoint /api/upload --requests 15

  # Test with JWT
  npm run test:client --jwt --tenant acme_corp --user alice

Available test tenants:
  - startup_free (free tier, strict limits)
  - acme_corp (pro tier, generous limits)
  - bigcorp_enterprise (enterprise tier, minimal restrictions)
  - demo_tenant (demo tenant with moderate limits)
  - test_tenant_1 (free tier test)
  - strict_tenant (very strict limits)
  - anonymous (default for unauthenticated)
  `);
}

// Run if called directly
if (require.main === module) {
  const config = parseArgs();
  void runTest(config);
}

export { runTest, makeRequest };
