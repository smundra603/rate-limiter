/**
 * Lua scripts for atomic token bucket operations in Redis
 */

/**
 * Token Bucket Lua Script
 *
 * This script atomically:
 * 1. Retrieves current bucket state (tokens, last_refill_ms)
 * 2. Calculates elapsed time and refills tokens
 * 3. Determines throttle state (normal/soft/hard)
 * 4. Consumes a token if allowed
 * 5. Updates Redis with new state
 *
 * THRESHOLD BEHAVIOR:
 * - Normal state (0 to soft%): Requests allowed, no warnings
 * - Soft throttle (soft% to hard%): Requests allowed WITH warnings
 * - Hard throttle (≥hard%): Requests REJECTED with 429 (in enforcement mode)
 *
 * Example: soft=100%, hard=110%
 *   - 0-99% usage → normal (allow, no warning)
 *   - 100-109% usage → soft (allow, with warning header)
 *   - ≥110% usage → hard (reject with 429)
 *
 * If soft_threshold equals hard_threshold, soft throttle is skipped:
 *   - 0 to (hard-1)% → normal
 *   - ≥hard% → hard throttle
 *
 * KEYS[1]: bucket key (e.g., "ratelimit:tenant:acme:user:123:bucket")
 *
 * ARGV[1]: capacity (max tokens)
 * ARGV[2]: refill_rate_per_sec (tokens added per second)
 * ARGV[3]: current_time_ms (current timestamp in milliseconds)
 * ARGV[4]: soft_threshold_pct (e.g., 100 = warning at 100%; can equal hard if skipping soft throttle)
 * ARGV[5]: hard_threshold_pct (e.g., 110 = reject at 110%)
 * ARGV[6]: ttl_seconds (bucket expiration time, default 3600)
 *
 * Returns: [allowed, state, tokens_remaining, usage_pct]
 *   - allowed: 1 if request allowed, 0 if rejected
 *   - state: 0=normal, 1=soft throttle, 2=hard throttle
 *   - tokens_remaining: current token count after operation
 *   - usage_pct: usage percentage (0-100+)
 */
export const TOKEN_BUCKET_LUA_SCRIPT = `
-- Parse arguments
local capacity = tonumber(ARGV[1])
local refill_rate_per_sec = tonumber(ARGV[2])
local current_time_ms = tonumber(ARGV[3])
local soft_threshold_pct = tonumber(ARGV[4])
local hard_threshold_pct = tonumber(ARGV[5])
local ttl_seconds = tonumber(ARGV[6]) or 3600

-- Get current bucket state from Redis
local bucket_data = redis.call('HMGET', KEYS[1], 'tokens', 'last_refill_ms')
local current_tokens = tonumber(bucket_data[1]) or capacity
local last_refill_ms = tonumber(bucket_data[2]) or current_time_ms

-- Calculate elapsed time in seconds
local elapsed_seconds = (current_time_ms - last_refill_ms) / 1000.0

-- Refill tokens based on elapsed time
if elapsed_seconds > 0 then
  local tokens_to_add = elapsed_seconds * refill_rate_per_sec
  current_tokens = math.min(capacity, current_tokens + tokens_to_add)
  last_refill_ms = current_time_ms
end

-- Calculate usage percentage (tokens consumed / capacity * 100)
local tokens_consumed = capacity - current_tokens
local usage_pct = (tokens_consumed / capacity) * 100

-- Determine throttle state
local state = 0  -- normal
local allowed = 1

if usage_pct >= hard_threshold_pct then
  state = 2  -- hard throttle
  allowed = 0
elseif usage_pct >= soft_threshold_pct then
  state = 1  -- soft throttle
  allowed = 1  -- Allow but warn
end

-- Consume token if allowed
if allowed == 1 then
  current_tokens = current_tokens - 1

  -- Recalculate usage after consumption
  tokens_consumed = capacity - current_tokens
  usage_pct = (tokens_consumed / capacity) * 100

  -- Check if we've now exceeded hard threshold after consumption
  if usage_pct >= hard_threshold_pct then
    state = 2
    allowed = 0
    current_tokens = current_tokens + 1  -- Refund the token
  elseif usage_pct >= soft_threshold_pct then
    state = 1
  end
end

-- Update Redis atomically
if allowed == 1 then
  redis.call('HMSET', KEYS[1],
    'tokens', tostring(current_tokens),
    'last_refill_ms', tostring(last_refill_ms)
  )
  redis.call('EXPIRE', KEYS[1], ttl_seconds)
end

-- Return results
return {allowed, state, current_tokens, usage_pct}
`;

/**
 * Batch Token Bucket Check Script
 *
 * This script checks multiple buckets in a single operation
 * Used for hierarchical rate limiting (user -> tenant -> global)
 *
 * KEYS: Array of bucket keys
 * ARGV: Repeated pattern of [capacity, refill_rate, soft_pct, hard_pct] for each key
 *       Plus current_time_ms at the end
 *
 * Returns: Array of [allowed, state, tokens, usage_pct] for each bucket
 */
export const BATCH_TOKEN_BUCKET_LUA_SCRIPT = `
local current_time_ms = tonumber(ARGV[#ARGV])
local results = {}

-- Process each bucket
for i = 1, #KEYS do
  local key = KEYS[i]
  local argv_offset = (i - 1) * 4

  local capacity = tonumber(ARGV[argv_offset + 1])
  local refill_rate_per_sec = tonumber(ARGV[argv_offset + 2])
  local soft_threshold_pct = tonumber(ARGV[argv_offset + 3])
  local hard_threshold_pct = tonumber(ARGV[argv_offset + 4])
  local ttl_seconds = 3600

  -- Get current bucket state
  local bucket_data = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
  local current_tokens = tonumber(bucket_data[1]) or capacity
  local last_refill_ms = tonumber(bucket_data[2]) or current_time_ms

  -- Refill calculation
  local elapsed_seconds = (current_time_ms - last_refill_ms) / 1000.0
  if elapsed_seconds > 0 then
    local tokens_to_add = elapsed_seconds * refill_rate_per_sec
    current_tokens = math.min(capacity, current_tokens + tokens_to_add)
    last_refill_ms = current_time_ms
  end

  -- Calculate usage
  local tokens_consumed = capacity - current_tokens
  local usage_pct = (tokens_consumed / capacity) * 100

  -- Determine state
  local state = 0
  local allowed = 1

  if usage_pct >= hard_threshold_pct then
    state = 2
    allowed = 0
  elseif usage_pct >= soft_threshold_pct then
    state = 1
    allowed = 1
  end

  -- Store result
  table.insert(results, {allowed, state, current_tokens, usage_pct})
end

return results
`;

/**
 * SHA-1 hash cache for loaded scripts
 * Prevents reloading scripts on every request
 */
export const scriptSHAs: Map<string, string> = new Map();

/**
 * Script names for reference
 */
export const SCRIPT_NAMES = {
  TOKEN_BUCKET: 'TOKEN_BUCKET',
  BATCH_TOKEN_BUCKET: 'BATCH_TOKEN_BUCKET',
} as const;
