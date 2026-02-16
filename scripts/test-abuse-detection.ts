#!/usr/bin/env ts-node

/**
 * Test script for abuse detection system
 * Generates abusive traffic and verifies detection works
 */

import http from 'http';

interface TestConfig {
  host: string;
  port: number;
  tenant_id: string;
  user_id: string;
  endpoint: string;
  num_requests: number;
  wait_time_ms: number;
}

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function makeRequest(
  config: TestConfig
): Promise<{ status: number; headers: any; body: any }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: config.host,
      port: config.port,
      path: config.endpoint,
      method: 'GET',
      headers: {
        'X-Tenant-ID': config.tenant_id,
        'X-User-ID': config.user_id,
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: body ? JSON.parse(body) : null,
          });
        } catch {
          resolve({ status: res.statusCode || 0, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function getOverrides(host: string, port: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: '/admin/overrides',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.overrides || []);
        } catch {
          resolve([]);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function getJobStatus(host: string, port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: '/admin/abuse-detection/status',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateAbusiveTraffic(config: TestConfig): Promise<{
  totalRequests: number;
  throttledRequests: number;
  throttleRate: number;
}> {
  log('\n📊 Step 1: Generating abusive traffic...', colors.cyan);
  log(`  Target: ${config.tenant_id}`);
  log(`  Requests: ${config.num_requests}`);
  log(`  Endpoint: ${config.endpoint}`);

  let throttledCount = 0;
  const progressInterval = Math.max(1, Math.floor(config.num_requests / 10));

  for (let i = 1; i <= config.num_requests; i++) {
    try {
      const response = await makeRequest(config);

      if (response.status === 429) {
        throttledCount++;
      }

      if (i % progressInterval === 0 || i === config.num_requests) {
        const progress = ((i / config.num_requests) * 100).toFixed(0);
        const throttleRate = ((throttledCount / i) * 100).toFixed(1);
        process.stdout.write(
          `\r  Progress: ${progress}% (${i}/${config.num_requests}) | Throttled: ${throttledCount} (${throttleRate}%)`
        );
      }

      // Delay to spread requests over time for Prometheus rate() calculation
      // 300ms * 200 requests = 60 seconds (allows proper metric aggregation)
      if (i < config.num_requests) {
        await sleep(300);
      }
    } catch (error) {
      // Continue on errors
    }
  }

  const throttleRate = (throttledCount / config.num_requests) * 100;
  console.log(); // New line after progress

  log(`\n  ✅ Traffic generation complete`, colors.green);
  log(`  Total requests: ${config.num_requests}`);
  log(`  Throttled: ${throttledCount} (${throttleRate.toFixed(1)}%)`);

  return {
    totalRequests: config.num_requests,
    throttledRequests: throttledCount,
    throttleRate,
  };
}

async function waitForDetection(
  config: TestConfig,
  waitTimeMs: number
): Promise<void> {
  log(`\n⏳ Step 2: Waiting for abuse detection job...`, colors.cyan);

  // Check job status
  try {
    const status = await getJobStatus(config.host, config.port);
    if (status) {
      log(`  Job enabled: ${status.enabled}`);
      log(`  Job running: ${status.running}`);
      log(
        `  Check interval: ${status.config?.checkIntervalMs || 'unknown'}ms`
      );
      log(`  Throttle threshold: ${status.config?.throttleThreshold || 'unknown'}`);

      if (!status.enabled) {
        log(
          `  ⚠️  Warning: Abuse detection is disabled!`,
          colors.yellow
        );
        log(
          `  Set ABUSE_DETECTION_ENABLED=true in .env to enable`,
          colors.yellow
        );
      }
    }
  } catch (error) {
    log(`  ⚠️  Could not get job status`, colors.yellow);
  }

  const waitSeconds = Math.ceil(waitTimeMs / 1000);
  log(`  Waiting ${waitSeconds} seconds for detection to run...`);

  // Show countdown
  for (let i = waitSeconds; i > 0; i--) {
    process.stdout.write(`\r  Time remaining: ${i}s `);
    await sleep(1000);
  }
  console.log(); // New line after countdown
}

async function verifyOverride(config: TestConfig): Promise<boolean> {
  log(`\n🔍 Step 3: Checking for override...`, colors.cyan);

  try {
    const overrides = await getOverrides(config.host, config.port);

    log(`  Total active overrides: ${overrides.length}`);

    const tenantOverride = overrides.find(
      (o: any) => o.tenant_id === config.tenant_id
    );

    if (tenantOverride) {
      log(`  ✅ Override found for ${config.tenant_id}!`, colors.green);
      log(`     Type: ${tenantOverride.override_type}`);
      log(`     Source: ${tenantOverride.source}`);
      log(`     Reason: ${tenantOverride.reason}`);
      log(
        `     Expires: ${new Date(tenantOverride.expires_at).toLocaleString()}`
      );

      if (tenantOverride.penalty_multiplier) {
        log(`     Penalty: ${tenantOverride.penalty_multiplier * 100}% of original limit`);
      }

      return true;
    } else {
      log(`  ❌ No override found for ${config.tenant_id}`, colors.red);
      log(`     This could mean:`, colors.yellow);
      log(`     - Detection threshold not met (need >50% throttle rate)`, colors.yellow);
      log(`     - Detection job hasn't run yet (wait longer)`, colors.yellow);
      log(`     - Abuse detection is disabled`, colors.yellow);
      log(`     - Prometheus metrics not available`, colors.yellow);
      return false;
    }
  } catch (error) {
    log(`  ❌ Error checking overrides: ${error}`, colors.red);
    return false;
  }
}

async function testOverrideEffect(config: TestConfig): Promise<void> {
  log(`\n🧪 Step 4: Testing override effect...`, colors.cyan);
  log(`  Making test request to verify penalty is applied...`);

  try {
    const response = await makeRequest(config);

    log(`  Status: ${response.status}`);
    log(`  Limit: ${response.headers['x-ratelimit-limit'] || 'N/A'}`);
    log(`  Remaining: ${response.headers['x-ratelimit-remaining'] || 'N/A'}`);

    if (response.headers['x-ratelimit-limit']) {
      const limit = parseInt(response.headers['x-ratelimit-limit']);
      log(
        `  ${limit < 100 ? '✅ Reduced limit detected (penalty applied)' : '⚠️  Limit seems normal (penalty may not be applied yet)'}`,
        limit < 100 ? colors.green : colors.yellow
      );
    }
  } catch (error) {
    log(`  ❌ Test request failed: ${error}`, colors.red);
  }
}

async function runTest(config: TestConfig) {
  log('🚀 Abuse Detection Test Suite', colors.cyan);
  log('================================\n');

  const startTime = Date.now();

  try {
    // Step 1: Generate abusive traffic
    const trafficResult = await generateAbusiveTraffic(config);

    // Check if throttle rate is high enough
    if (trafficResult.throttleRate < 50) {
      log(
        `\n⚠️  Warning: Throttle rate (${trafficResult.throttleRate.toFixed(1)}%) is below 50% threshold`,
        colors.yellow
      );
      log(
        `   Detection may not trigger. Try increasing --requests to generate more throttling.`,
        colors.yellow
      );
    } else {
      log(
        `\n✅ Throttle rate (${trafficResult.throttleRate.toFixed(1)}%) exceeds 50% threshold`,
        colors.green
      );
      log(`   Abuse detection should trigger!`, colors.green);
    }

    // Step 2: Wait for detection
    await waitForDetection(config, config.wait_time_ms);

    // Step 3: Verify override was created
    const overrideFound = await verifyOverride(config);

    // Step 4: Test override effect
    if (overrideFound) {
      await testOverrideEffect(config);
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n\n📋 Test Summary`, colors.cyan);
    log('=================================');
    log(`  Duration: ${duration}s`);
    log(`  Requests sent: ${trafficResult.totalRequests}`);
    log(`  Throttle rate: ${trafficResult.throttleRate.toFixed(1)}%`);
    log(
      `  Override created: ${overrideFound ? '✅ Yes' : '❌ No'}`,
      overrideFound ? colors.green : colors.red
    );

    if (overrideFound) {
      log(`\n✅ Test PASSED: Abuse detection is working!`, colors.green);
      log(
        `   The system detected abuse and created an override automatically.`,
        colors.green
      );
    } else {
      log(`\n⚠️  Test INCOMPLETE: Override not found`, colors.yellow);
      log(`   Possible reasons:`);
      log(`   1. Wait longer for detection job to run`);
      log(`   2. Increase --requests to trigger more throttling`);
      log(`   3. Check if abuse detection is enabled in .env`);
      log(`   4. Check Prometheus metrics are being collected`);
    }
  } catch (error) {
    log(`\n❌ Test FAILED: ${error}`, colors.red);
    throw error;
  }
}

// ==================== CLI Interface ====================

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = {
    host: 'localhost',
    port: 8080,
    tenant_id: 'abuse_test_tenant',
    user_id: 'test_user',
    endpoint: '/api/search',
    num_requests: 200,
    wait_time_ms: 80000, // 80 seconds (traffic gen ~60s + detection interval 60s + buffer)
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
      case '--wait':
      case '-w':
        config.wait_time_ms = parseInt(value, 10) * 1000;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
Abuse Detection Test Script

Tests the automated abuse detection system by:
1. Generating abusive traffic (high throttle rate)
2. Waiting for detection job to run
3. Verifying override was created
4. Testing that override is being applied

Usage:
  npm run test:abuse [options]

Options:
  --host <host>         Host (default: localhost)
  --port <port>         Port (default: 8080)
  --tenant <id>         Tenant ID to test (default: abuse_test_tenant)
  --user <id>           User ID (default: test_user)
  --endpoint <path>     Endpoint path (default: /api/search)
  -n, --requests <num>  Number of requests (default: 200)
  -w, --wait <seconds>  Wait time for detection in seconds (default: 70)
  -h, --help            Show this help

Examples:
  # Basic test (default settings)
  npm run test:abuse

  # Quick test with specific tenant
  npm run test:abuse --tenant demo_tenant --requests 150

  # Test with longer wait time
  npm run test:abuse --wait 120

  # Test specific endpoint
  npm run test:abuse --endpoint /api/upload --requests 100

Note:
  - Ensure the rate limiter service is running
  - Ensure Prometheus is running and collecting metrics
  - Default detection interval is 1 minute
  - Need >50% throttle rate to trigger detection
  `);
}

// Run if called directly
if (require.main === module) {
  const config = parseArgs();
  void runTest(config).catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { runTest };
