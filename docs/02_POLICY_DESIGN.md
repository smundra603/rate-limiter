# Rate Limiting Policy Design & Scenarios

## Table of Contents
- [Policy Schema](#policy-schema)
- [Configuration Hierarchy](#configuration-hierarchy)
- [Policy Examples by Tier](#policy-examples-by-tier)
- [Detailed Scenarios](#detailed-scenarios)
- [Progressive Throttling Examples](#progressive-throttling-examples)

---

## Policy Schema

### Tenant Policy Schema

```typescript
interface TenantRateLimitPolicy {
  _id: string;                    // MongoDB document ID
  tenant_id: string;               // Unique tenant identifier
  tier: 'free' | 'pro' | 'enterprise' | 'custom';
  policies: {
    // Tenant-level limits (global for tenant across all users)
    tenant: BucketPolicy;
    
    // Per-user limits (optional - if not set, no per-user limiting)
    user?: BucketPolicy;
    
    // Per-endpoint overrides (optional)
    endpoints?: {
      [endpoint: string]: BucketPolicy;
    };
    
    // Throttle configuration
    throttle_config: ThrottleConfig;
  };
  created_at: Date;
  updated_at: Date;
}

interface BucketPolicy {
  rpm: number;                    // Requests per minute (sustained rate)
  rps: number;                    // Requests per second (for finer granularity)
  burst_capacity: number;         // Maximum tokens in bucket
  refill_rate_per_sec?: number;  // Auto-calculated: rpm / 60
}

interface ThrottleConfig {
  soft_threshold_pct: number;     // % of limit for soft throttle (default: 100)
  hard_threshold_pct: number;     // % of limit for hard throttle (default: 105)
}
```

### Global Policy Schema

```typescript
interface GlobalRateLimitPolicy {
  _id: 'global_config';           // Singleton document
  policies: {
    // Global system-wide limits
    global: BucketPolicy;
    
    // Per-endpoint global limits (override global for specific endpoints)
    endpoints?: {
      [endpoint: string]: BucketPolicy;
    };
  };
  updated_at: Date;
}
```

---

## Configuration Hierarchy

### Limit Stacking Rules

Rate limits are checked in this order, and **ALL** must pass:

```
1. User-level limit (if configured for this endpoint)
   ↓
2. Tenant-level limit
   ↓
3. Endpoint-level limit (if configured for this endpoint)
   ↓
4. Global system limit
```

### Precedence Example

```json
{
  "tenant_id": "acme_corp",
  "policies": {
    "tenant": {
      "rpm": 10000,
      "burst_capacity": 15000
    },
    "user": {
      "rpm": 500,
      "burst_capacity": 1000
    },
    "endpoints": {
      "/api/expensive-query": {
        "rpm": 100,
        "burst_capacity": 150
      }
    }
  }
}
```

**Request Flow:**
- User `john@acme.com` calls `/api/expensive-query`
- Check 1: User limit → 500 RPM ✓
- Check 2: Tenant limit → 10000 RPM ✓
- Check 3: Endpoint limit → 100 RPM ✗ (exceeded)
- **Result:** Throttled by endpoint limit, even though user and tenant are fine

---

## Policy Examples by Tier

### Free Tier Policy

```json
{
  "_id": "tenant_free_001",
  "tenant_id": "tenant_free_001",
  "tier": "free",
  "policies": {
    "tenant": {
      "rpm": 1000,
      "rps": 16,
      "burst_capacity": 1500,
      "refill_rate_per_sec": 16.67
    },
    "user": {
      "rpm": 100,
      "rps": 2,
      "burst_capacity": 150,
      "refill_rate_per_sec": 1.67
    },
    "endpoints": {
      "/api/upload": {
        "rpm": 20,
        "rps": 1,
        "burst_capacity": 25
      }
    },
    "throttle_config": {
      "soft_threshold_pct": 100,
      "hard_threshold_pct": 105
    }
  }
}
```

**Characteristics:**
- Low sustained rate (1000 RPM tenant)
- Minimal burst capacity (1.5x sustained)
- Strict per-user limits (100 RPM)
- Special restrictions on expensive endpoints (upload limited to 20 RPM)

---

### Pro Tier Policy

```json
{
  "_id": "tenant_pro_001",
  "tenant_id": "tenant_pro_001",
  "tier": "pro",
  "policies": {
    "tenant": {
      "rpm": 10000,
      "rps": 166,
      "burst_capacity": 20000,
      "refill_rate_per_sec": 166.67
    },
    "user": {
      "rpm": 1000,
      "rps": 16,
      "burst_capacity": 2000,
      "refill_rate_per_sec": 16.67
    },
    "endpoints": {
      "/api/upload": {
        "rpm": 500,
        "rps": 8,
        "burst_capacity": 750
      },
      "/api/search": {
        "rpm": 5000,
        "rps": 83,
        "burst_capacity": 7500
      }
    },
    "throttle_config": {
      "soft_threshold_pct": 100,
      "hard_threshold_pct": 105
    }
  }
}
```

**Characteristics:**
- 10x higher than free tier
- Generous burst capacity (2x sustained)
- Higher per-user limits for power users
- Balanced endpoint limits

---

### Enterprise Tier Policy

```json
{
  "_id": "tenant_enterprise_001",
  "tenant_id": "tenant_enterprise_001",
  "tier": "enterprise",
  "policies": {
    "tenant": {
      "rpm": 100000,
      "rps": 1666,
      "burst_capacity": 200000,
      "refill_rate_per_sec": 1666.67
    },
    "user": {
      "rpm": 10000,
      "rps": 166,
      "burst_capacity": 20000,
      "refill_rate_per_sec": 166.67
    },
    "endpoints": {},
    "throttle_config": {
      "soft_threshold_pct": 100,
      "hard_threshold_pct": 110
    }
  }
}
```

**Characteristics:**
- Very high limits for enterprise scale
- Large burst capacity for batch processing
- No endpoint restrictions (trust enterprise customers)
- Wider soft throttle buffer (110% vs 105%)

---

### Custom Tier with Endpoint-Specific Policies

```json
{
  "_id": "tenant_custom_analytics",
  "tenant_id": "tenant_custom_analytics",
  "tier": "custom",
  "policies": {
    "tenant": {
      "rpm": 50000,
      "rps": 833,
      "burst_capacity": 75000
    },
    "user": {
      "rpm": 5000,
      "rps": 83,
      "burst_capacity": 7500
    },
    "endpoints": {
      "/api/analytics/query": {
        "rpm": 10000,
        "rps": 166,
        "burst_capacity": 15000
      },
      "/api/analytics/export": {
        "rpm": 100,
        "rps": 2,
        "burst_capacity": 120
      },
      "/api/dashboard/realtime": {
        "rpm": 20000,
        "rps": 333,
        "burst_capacity": 30000
      }
    },
    "throttle_config": {
      "soft_threshold_pct": 95,
      "hard_threshold_pct": 100
    }
  }
}
```

**Characteristics:**
- Tailored for analytics workload
- High limits for real-time dashboard
- Restricted export operations (expensive)
- Aggressive throttling (soft at 95%, hard at 100%)

---

### Global System Policy

```json
{
  "_id": "global_config",
  "policies": {
    "global": {
      "rpm": 100000,
      "rps": 1666,
      "burst_capacity": 150000,
      "refill_rate_per_sec": 1666.67
    },
    "endpoints": {
      "/api/ml/inference": {
        "rpm": 5000,
        "rps": 83,
        "burst_capacity": 6000
      },
      "/api/video/transcode": {
        "rpm": 1000,
        "rps": 16,
        "burst_capacity": 1200
      }
    }
  }
}
```

**Characteristics:**
- Protects entire system from overload
- Special limits for compute-intensive endpoints
- Global limits apply **in addition to** tenant limits

---

## Detailed Scenarios

### Scenario 1: Dashboard Load (Burst Scenario)

**Context:**  
User loads a dashboard that makes 25 parallel API calls to render widgets.

**Configuration:**
```json
{
  "tenant": { "rpm": 5000, "burst_capacity": 10000 },
  "user": { "rpm": 500, "burst_capacity": 1000 }
}
```

**Timeline:**

| Time | Event | User Tokens Before | User Tokens After | Result |
|------|-------|-------------------|-------------------|--------|
| 0ms | Page load triggers 25 requests | 1000 (full) | 975 | ✓ All allowed |
| 0ms | Requests processed in parallel | - | - | Normal state |
| 1000ms | Token refill | 975 | 983.33 | +8.33 tokens |
| 2000ms | User makes 5 more requests | 983.33 | 978.33 | ✓ Allowed |

**Outcome:**
- ✅ Burst capacity (1000) allows all 25 parallel requests
- ✅ Refill rate (8.33/sec) replenishes tokens for sustained usage
- ✅ No throttling triggered

---

### Scenario 2: Sustained High Load (Batch Processing)

**Context:**  
Tenant runs nightly batch job making 200 requests/minute for 30 minutes.

**Configuration:**
```json
{
  "tenant": { "rpm": 10000, "burst_capacity": 15000 },
  "user": { "rpm": 500, "burst_capacity": 1000 }
}
```

**Timeline:**

| Minute | Requests Made | User Tokens | Tenant Tokens | Result |
|--------|---------------|-------------|---------------|--------|
| 0 | 200 | 1000 → 800 | 15000 → 14800 | ✓ Normal |
| 1 | 200 | 500 (refilled) → 300 | 14966 → 14766 | ✓ Normal |
| 2 | 200 | 500 → 300 | 14932 → 14732 | ✓ Normal |
| 3 | 200 | 500 → 300 | 14898 → 14698 | ✓ Normal |
| ... | ... | Stable at ~300-500 | Slowly decreasing | ✓ Normal |

**Outcome:**
- ⚠️ User tokens stabilize at 300-500 (consuming faster than refill)
- ✅ Tenant has plenty of capacity (14k+ tokens remaining)
- ✅ No throttling, sustained rate within limits

---

### Scenario 3: Multi-User Tenant with Quota Exhaustion

**Context:**  
Tenant has 10 active users. One user consumes their quota, others continue normally.

**Configuration:**
```json
{
  "tenant": { "rpm": 10000, "burst_capacity": 15000 },
  "user": { "rpm": 500, "burst_capacity": 1000 }
}
```

**User Activity:**

| User | Requests/Min | User Tokens | Tenant Tokens | Status |
|------|--------------|-------------|---------------|--------|
| user_1 | 550 | 0 (exhausted) | 14450 | 🔴 Hard Throttled |
| user_2 | 400 | 600 | 14050 | ✅ Normal |
| user_3 | 400 | 600 | 13650 | ✅ Normal |
| user_4 | 400 | 600 | 13250 | ✅ Normal |
| ... | ... | ... | ... | ... |

**Outcome:**
- ✅ User-level limits prevent single user from hogging tenant quota
- ✅ Other users unaffected by user_1's overconsumption
- ✅ Fair resource distribution

---

### Scenario 4: Endpoint-Specific Limit Enforcement

**Context:**  
Tenant has different limits for different endpoints.

**Configuration:**
```json
{
  "tenant": { "rpm": 10000 },
  "endpoints": {
    "/api/search": { "rpm": 5000 },
    "/api/upload": { "rpm": 100 }
  }
}
```

**Request Pattern:**

| Endpoint | Requests | Tenant Tokens | Endpoint Tokens | Result |
|----------|----------|---------------|-----------------|--------|
| /api/search | 4800/min | 5200 | 200 | ✅ Normal |
| /api/search | 5100/min | 100 | 0 | 🟡 Soft Throttle (102% of endpoint limit) |
| /api/upload | 95/min | 5 | 5 | ✅ Normal |
| /api/upload | 110/min | 0 | 0 | 🔴 Hard Throttle (110% of endpoint limit) |

**Outcome:**
- ✅ Endpoint-specific limits protect expensive operations
- ✅ Tenant limit not exhausted, but endpoint limit enforced
- ✅ Different endpoints can have vastly different capacities

---

### Scenario 5: Global System Capacity Reached

**Context:**  
System is under heavy load from all tenants combined.

**Configuration:**
```json
{
  "global": { "rpm": 100000, "burst_capacity": 150000 },
  "tenant_A": { "rpm": 10000 },
  "tenant_B": { "rpm": 10000 }
}
```

**System State:**

| Time | Global Tokens | Tenant A Request | Tenant B Request | Result |
|------|---------------|------------------|------------------|--------|
| 0ms | 150000 | 100 req | 100 req | ✓ Both allowed |
| ... | ... | ... | ... | ... |
| 30s | 5000 | 200 req | 200 req | ✓ Both allowed |
| 31s | 4600 | 300 req | 300 req | ✓ Both allowed |
| 32s | 4000 | 300 req | 300 req | ✓ Both allowed |
| 33s | 500 (low!) | 300 req | 300 req | 🟡 Both soft throttled |
| 34s | 0 | 300 req | 300 req | 🔴 Both hard throttled |

**Outcome:**
- ✅ Global limit prevents system overload
- ⚠️ All tenants affected when global capacity reached (fair)
- ✅ System remains operational, not crashed

---

### Scenario 6: Anonymous Request Limiting by IP

**Context:**  
Unauthenticated requests rate limited by source IP address.

**Configuration:**
```json
{
  "anonymous": {
    "rpm": 100,
    "burst_capacity": 150
  }
}
```

**Request Pattern:**

| Source IP | Requests/Min | IP Tokens | Result |
|-----------|--------------|-----------|--------|
| 192.168.1.100 | 90 | 60 | ✅ Normal |
| 192.168.1.100 | 105 | 0 | 🟡 Soft Throttle |
| 192.168.1.101 | 50 | 100 | ✅ Normal (different IP) |
| 192.168.1.100 | 110 | 0 | 🔴 Hard Throttle |

**Outcome:**
- ✅ Each IP gets its own token bucket
- ✅ Prevents single IP from overwhelming public endpoints
- ✅ Different IPs do not affect each other

---

## Progressive Throttling Examples

### Example 1: Normal → Soft → Hard Transition

**Configuration:**
```json
{
  "user": { "rpm": 1000, "burst_capacity": 1500 },
  "throttle_config": {
    "soft_threshold_pct": 100,
    "hard_threshold_pct": 105
  }
}
```

**Timeline:**

| Requests Made | Tokens Remaining | Usage % | State | Response |
|---------------|------------------|---------|-------|----------|
| 0 | 1500 | 0% | Normal | 200 OK |
| 1000 | 500 | 66% | Normal | 200 OK |
| 1400 | 100 | 93% | Normal | 200 OK |
| 1500 | 0 | 100% | Normal | 200 OK (exact limit) |
| 1510 | -10 | 100.6% | 🟡 Soft | 200 + Warning |
| 1550 | -50 | 103% | 🟡 Soft | 200 + Warning |
| 1580 | -80 | 105.3% | 🔴 Hard | 429 Too Many Requests |

**HTTP Headers (Soft Throttle):**
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1500
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709123500
X-RateLimit-Warning: true
X-RateLimit-Retry-After: 5
```

**HTTP Response (Hard Throttle):**
```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 1500
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709123500
Retry-After: 15
```

---

### Example 2: Configurable Throttle Windows

**Free Tier - Strict:**
```json
{
  "throttle_config": {
    "soft_threshold_pct": 105,
    "hard_threshold_pct": 110
  }
}
```

| Usage % | State | Behavior |
|---------|-------|----------|
| 0-100% | Normal | Full speed |
| 100-110% | Soft | Warning headers |
| >110% | Hard | Rejected |

**Enterprise Tier - Generous:**
```json
{
  "throttle_config": {
    "soft_threshold_pct": 100,
    "hard_threshold_pct": 120
  }
}
```

| Usage % | State | Behavior |
|---------|-------|----------|
| 0-100% | Normal | Full speed |
| 100-120% | Soft | Warning headers, extra 20% buffer |
| >120% | Hard | Rejected |

---

### Example 3: Multi-Scope Throttle Aggregation

**Scenario:**  
User hits soft throttle on tenant limit, but hard throttle on endpoint limit.

**State:**
- User limit: 450/500 (90% - Normal)
- Tenant limit: 9600/10000 (96% - Normal)
- Endpoint limit: 1050/1000 (105% - Hard)
- Global limit: 75000/100000 (75% - Normal)

**Result:**  
🔴 **Hard Throttle** (worst state wins)

**Response:**
```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Scope: endpoint
X-RateLimit-Endpoint: /api/search
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709123560
```

---

## Policy Management

### Hot Reload Behavior

```typescript
// Policy cache with TTL
const policyCache = new LRUCache<string, TenantRateLimitPolicy>({
  max: 10000,
  ttl: 60000,  // 60 seconds
  updateAgeOnGet: true
});

// Background refresh every 30 seconds
setInterval(async () => {
  const activeTenants = policyCache.keys();
  const freshPolicies = await mongodb.find({ 
    tenant_id: { $in: activeTenants } 
  });
  
  freshPolicies.forEach(policy => {
    policyCache.set(policy.tenant_id, policy);
  });
}, 30000);
```

**Behavior:**
- Policy changes effective within 60 seconds (max staleness)
- Active tenants refreshed every 30 seconds
- No immediate invalidation needed (eventual consistency acceptable)

---

## Summary Table

| Tier | Tenant RPM | User RPM | Burst Multiplier | Soft % | Hard % |
|------|-----------|----------|------------------|--------|--------|
| Free | 1,000 | 100 | 1.5x | 100% | 105% |
| Pro | 10,000 | 1,000 | 2.0x | 100% | 105% |
| Enterprise | 100,000 | 10,000 | 2.0x | 100% | 110% |
| Global | 100,000 | - | 1.5x | 100% | 105% |

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-14
