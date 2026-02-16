/**
 * Environment variable helper functions
 * Extract and parse environment variables with type safety and validation
 */

/**
 * Get environment variable as string with optional default
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : (defaultValue ?? '');
}

/**
 * Get required environment variable (throws if missing or empty)
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get environment variable as integer with validation
 */
export function getEnvAsInt(key: string, defaultValue: number): number {
  const value = process.env[key];

  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: ${value}`);
  }

  return parsed;
}

/**
 * Get environment variable as float with validation
 */
export function getEnvAsFloat(key: string, defaultValue: number): number {
  const value = process.env[key];

  if (!value) {
    return defaultValue;
  }

  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number, got: ${value}`);
  }

  return parsed;
}

/**
 * Get environment variable as boolean
 * Only 'false', 'FALSE', '0', and empty string are considered false
 * Everything else (including 'true', '1', 'yes', etc.) is true
 */
export function getEnvAsBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];

  if (!value) {
    return defaultValue;
  }

  const lowerValue = value.toLowerCase();
  return lowerValue !== 'false' && lowerValue !== '0' && value !== '';
}
