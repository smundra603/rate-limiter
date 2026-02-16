#!/usr/bin/env ts-node

/**
 * Test script for admin API endpoints
 * Tests manual override management
 */

import http from 'http';

interface TestConfig {
  host: string;
  port: number;
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

async function request(
  config: TestConfig,
  path: string,
  method: string = 'GET',
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const options: any = {
      hostname: config.host,
      port: config.port,
      path,
      method,
      headers: {},
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 0,
            body: responseBody ? JSON.parse(responseBody) : null,
          });
        } catch {
          resolve({ status: res.statusCode || 0, body: responseBody });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function testGetOverrides(config: TestConfig): Promise<void> {
  log('\n📋 Test 1: GET /admin/overrides', colors.cyan);
  log('  Listing all active overrides...');

  try {
    const response = await request(config, '/admin/overrides');

    if (response.status === 200) {
      log(`  ✅ Status: ${response.status}`, colors.green);
      log(`  Count: ${response.body?.count || 0}`);

      if (response.body?.overrides && response.body.overrides.length > 0) {
        log(`  Active overrides:`);
        response.body.overrides.forEach((override: any, index: number) => {
          log(`    ${index + 1}. Tenant: ${override.tenant_id}`);
          log(`       Type: ${override.override_type}`);
          log(`       Source: ${override.source}`);
          log(`       Expires: ${new Date(override.expires_at).toLocaleString()}`);
        });
      } else {
        log(`  No active overrides found`);
      }
    } else {
      log(`  ❌ Status: ${response.status}`, colors.red);
      log(`  Body: ${JSON.stringify(response.body)}`);
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
  }
}

async function testCreatePenaltyOverride(
  config: TestConfig
): Promise<string | null> {
  log('\n➕ Test 2: POST /admin/overrides (Penalty Multiplier)', colors.cyan);
  log('  Creating manual penalty override...');

  const override = {
    tenant_id: 'test_manual_penalty',
    override_type: 'penalty_multiplier',
    penalty_multiplier: 0.5,
    reason: 'Manual test: 50% penalty',
    duration_minutes: 2,
  };

  try {
    const response = await request(config, '/admin/overrides', 'POST', override);

    if (response.status === 201) {
      log(`  ✅ Status: ${response.status}`, colors.green);
      log(`  Override ID: ${response.body?.override?._id}`);
      log(`  Tenant: ${response.body?.override?.tenant_id}`);
      log(`  Type: ${response.body?.override?.override_type}`);
      log(
        `  Penalty: ${response.body?.override?.penalty_multiplier * 100}%`
      );
      log(
        `  Expires: ${new Date(response.body?.override?.expires_at).toLocaleString()}`
      );
      return response.body?.override?._id || null;
    } else {
      log(`  ❌ Status: ${response.status}`, colors.red);
      log(`  Body: ${JSON.stringify(response.body)}`);
      return null;
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
    return null;
  }
}

async function testCreateBanOverride(config: TestConfig): Promise<string | null> {
  log('\n🚫 Test 3: POST /admin/overrides (Temporary Ban)', colors.cyan);
  log('  Creating manual ban override...');

  const override = {
    tenant_id: 'test_manual_ban',
    override_type: 'temporary_ban',
    reason: 'Manual test: Temporary ban',
    duration_minutes: 2,
  };

  try {
    const response = await request(config, '/admin/overrides', 'POST', override);

    if (response.status === 201) {
      log(`  ✅ Status: ${response.status}`, colors.green);
      log(`  Override ID: ${response.body?.override?._id}`);
      log(`  Tenant: ${response.body?.override?.tenant_id}`);
      log(`  Type: ${response.body?.override?.override_type}`);
      log(
        `  Expires: ${new Date(response.body?.override?.expires_at).toLocaleString()}`
      );
      return response.body?.override?._id || null;
    } else {
      log(`  ❌ Status: ${response.status}`, colors.red);
      log(`  Body: ${JSON.stringify(response.body)}`);
      return null;
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
    return null;
  }
}

async function testCreateCustomLimitOverride(
  config: TestConfig
): Promise<string | null> {
  log('\n⚙️  Test 4: POST /admin/overrides (Custom Limit)', colors.cyan);
  log('  Creating custom limit override...');

  const override = {
    tenant_id: 'test_custom_limit',
    override_type: 'custom_limit',
    custom_rate: 10,
    custom_burst: 5,
    reason: 'Manual test: Custom low limit',
    duration_minutes: 2,
  };

  try {
    const response = await request(config, '/admin/overrides', 'POST', override);

    if (response.status === 201) {
      log(`  ✅ Status: ${response.status}`, colors.green);
      log(`  Override ID: ${response.body?.override?._id}`);
      log(`  Tenant: ${response.body?.override?.tenant_id}`);
      log(`  Type: ${response.body?.override?.override_type}`);
      log(`  Custom Rate: ${response.body?.override?.custom_rate} RPM`);
      log(`  Custom Burst: ${response.body?.override?.custom_burst}`);
      log(
        `  Expires: ${new Date(response.body?.override?.expires_at).toLocaleString()}`
      );
      return response.body?.override?._id || null;
    } else {
      log(`  ❌ Status: ${response.status}`, colors.red);
      log(`  Body: ${JSON.stringify(response.body)}`);
      return null;
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
    return null;
  }
}

async function testInvalidOverride(config: TestConfig): Promise<void> {
  log('\n❌ Test 5: POST /admin/overrides (Invalid)', colors.cyan);
  log('  Testing validation with missing fields...');

  const invalidOverride = {
    tenant_id: 'test_invalid',
    override_type: 'penalty_multiplier',
    // Missing penalty_multiplier, reason, duration_minutes
  };

  try {
    const response = await request(
      config,
      '/admin/overrides',
      'POST',
      invalidOverride
    );

    if (response.status === 400) {
      log(`  ✅ Correctly rejected with status: ${response.status}`, colors.green);
      log(`  Error: ${response.body?.message || response.body?.error}`);
    } else {
      log(
        `  ⚠️  Expected 400, got ${response.status}`,
        colors.yellow
      );
      log(`  Body: ${JSON.stringify(response.body)}`);
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
  }
}

async function testDeleteOverride(
  config: TestConfig,
  overrideId: string
): Promise<void> {
  log('\n🗑️  Test 6: DELETE /admin/overrides/:id', colors.cyan);
  log(`  Deleting override: ${overrideId}...`);

  try {
    const response = await request(
      config,
      `/admin/overrides/${overrideId}`,
      'DELETE'
    );

    if (response.status === 200) {
      log(`  ✅ Status: ${response.status}`, colors.green);
      log(`  Message: ${response.body?.message}`);
    } else {
      log(`  ❌ Status: ${response.status}`, colors.red);
      log(`  Body: ${JSON.stringify(response.body)}`);
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
  }
}

async function testDeleteNonExistent(config: TestConfig): Promise<void> {
  log('\n🔍 Test 7: DELETE /admin/overrides/:id (Non-existent)', colors.cyan);
  log('  Attempting to delete non-existent override...');

  const fakeId = '507f1f77bcf86cd799439011'; // Valid MongoDB ObjectId format

  try {
    const response = await request(config, `/admin/overrides/${fakeId}`, 'DELETE');

    if (response.status === 404) {
      log(`  ✅ Correctly returned 404`, colors.green);
      log(`  Message: ${response.body?.message}`);
    } else {
      log(
        `  ⚠️  Expected 404, got ${response.status}`,
        colors.yellow
      );
      log(`  Body: ${JSON.stringify(response.body)}`);
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
  }
}

async function testJobStatus(config: TestConfig): Promise<void> {
  log('\n📊 Test 8: GET /admin/abuse-detection/status', colors.cyan);
  log('  Getting abuse detection job status...');

  try {
    const response = await request(config, '/admin/abuse-detection/status');

    if (response.status === 200) {
      log(`  ✅ Status: ${response.status}`, colors.green);
      log(`  Job enabled: ${response.body?.enabled}`);
      log(`  Job running: ${response.body?.running}`);
      if (response.body?.lastRunTime) {
        log(
          `  Last run: ${new Date(response.body.lastRunTime).toLocaleString()}`
        );
      }
      if (response.body?.config) {
        log(`  Configuration:`);
        log(`    Check interval: ${response.body.config.checkIntervalMs}ms`);
        log(`    Throttle threshold: ${response.body.config.throttleThreshold}`);
        log(
          `    Detection window: ${response.body.config.detectionWindowMinutes}min`
        );
        log(`    Penalty type: ${response.body.config.penaltyType}`);
        log(
          `    Penalty duration: ${response.body.config.penaltyDurationMs}ms`
        );
      }
    } else {
      log(`  ❌ Status: ${response.status}`, colors.red);
      log(`  Body: ${JSON.stringify(response.body)}`);
    }
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
  }
}

async function testRequestWithOverride(
  config: TestConfig,
  tenantId: string,
  testName: string
): Promise<void> {
  log(`\n🧪 Test: Make request as ${tenantId}`, colors.cyan);
  log(`  Testing ${testName}...`);

  try {
    // Make request with tenant header
    const options = {
      hostname: config.host,
      port: config.port,
      path: '/api/search',
      method: 'GET',
      headers: {
        'X-Tenant-ID': tenantId,
        'X-User-ID': 'test_user',
      },
    };

    const req = http.request(options, (res) => {
      log(`  Status: ${res.statusCode}`);
      log(`  Limit: ${res.headers['x-ratelimit-limit'] || 'N/A'}`);
      log(`  Remaining: ${res.headers['x-ratelimit-remaining'] || 'N/A'}`);

      if (res.statusCode === 429) {
        log(`  ✅ Request blocked (ban is working)`, colors.green);
      } else if (res.headers['x-ratelimit-limit']) {
        const limit = parseInt(res.headers['x-ratelimit-limit'] as string);
        if (limit < 100) {
          log(`  ✅ Reduced limit detected (penalty is working)`, colors.green);
        } else {
          log(`  ⚠️  Limit seems normal`, colors.yellow);
        }
      }

      res.on('data', () => {}); // Consume response
    });

    req.on('error', (error) => {
      log(`  ❌ Error: ${error}`, colors.red);
    });

    req.end();
  } catch (error) {
    log(`  ❌ Error: ${error}`, colors.red);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function runTests(config: TestConfig) {
  log('🚀 Admin API Test Suite', colors.cyan);
  log('================================\n');

  const startTime = Date.now();
  const createdOverrides: string[] = [];

  try {
    // Test 1: List overrides
    await testGetOverrides(config);

    // Test 2: Create penalty override
    const penaltyId = await testCreatePenaltyOverride(config);
    if (penaltyId) {
      createdOverrides.push(penaltyId);
      await testRequestWithOverride(
        config,
        'test_manual_penalty',
        'penalty multiplier effect'
      );
    }

    // Test 3: Create ban override
    const banId = await testCreateBanOverride(config);
    if (banId) {
      createdOverrides.push(banId);
      await testRequestWithOverride(
        config,
        'test_manual_ban',
        'temporary ban effect'
      );
    }

    // Test 4: Create custom limit override
    const customId = await testCreateCustomLimitOverride(config);
    if (customId) {
      createdOverrides.push(customId);
      await testRequestWithOverride(
        config,
        'test_custom_limit',
        'custom limit effect'
      );
    }

    // Test 5: Invalid override
    await testInvalidOverride(config);

    // Test 6: Delete override
    if (createdOverrides.length > 0) {
      await testDeleteOverride(config, createdOverrides[0]);
    }

    // Test 7: Delete non-existent
    await testDeleteNonExistent(config);

    // Test 8: Job status
    await testJobStatus(config);

    // Cleanup: Delete remaining test overrides
    if (createdOverrides.length > 1) {
      log('\n🧹 Cleanup: Deleting remaining test overrides...', colors.cyan);
      for (let i = 1; i < createdOverrides.length; i++) {
        try {
          await request(config, `/admin/overrides/${createdOverrides[i]}`, 'DELETE');
          log(`  Deleted: ${createdOverrides[i]}`);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n\n📋 Test Summary`, colors.cyan);
    log('=================================');
    log(`  Duration: ${duration}s`);
    log(`  Overrides created: ${createdOverrides.length}`);
    log(`\n✅ All tests completed!`, colors.green);
  } catch (error) {
    log(`\n❌ Test suite failed: ${error}`, colors.red);
    throw error;
  }
}

// ==================== CLI Interface ====================

function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = {
    host: 'localhost',
    port: 8080,
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
Admin API Test Script

Tests all admin API endpoints for manual override management:
- GET /admin/overrides
- POST /admin/overrides (penalty_multiplier, temporary_ban, custom_limit)
- DELETE /admin/overrides/:id
- GET /admin/abuse-detection/status

Usage:
  npm run test:admin [options]

Options:
  --host <host>  Host (default: localhost)
  --port <port>  Port (default: 8080)
  -h, --help     Show this help

Examples:
  # Run all tests
  npm run test:admin

  # Test against specific host
  npm run test:admin --host 192.168.1.100 --port 8080

Note:
  - Ensure the rate limiter service is running
  - Test overrides are automatically cleaned up after tests
  `);
}

// Run if called directly
if (require.main === module) {
  const config = parseArgs();
  void runTests(config).catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { runTests };
