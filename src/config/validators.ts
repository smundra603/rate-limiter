/**
 * Validation utilities for configuration values
 */

/**
 * Validate that a value is within a numeric range
 */
export function validateRange(value: number, min: number, max: number, fieldName: string): void {
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}, got: ${value}`);
  }
}

/**
 * Validate that a value is one of allowed options
 */
export function validateEnum<T extends string>(
  value: T,
  allowedValues: readonly T[],
  fieldName: string
): void {
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}, got: ${value}`);
  }
}

/**
 * Validate URL format
 */
export function validateUrl(value: string, fieldName: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a valid URL, got: ${value}`);
  }
}

/**
 * Validate positive number
 */
export function validatePositive(value: number, fieldName: string): void {
  if (value <= 0) {
    throw new Error(`${fieldName} must be greater than 0, got: ${value}`);
  }
}

/**
 * Validate non-negative number
 */
export function validateNonNegative(value: number, fieldName: string): void {
  if (value < 0) {
    throw new Error(`${fieldName} must be >= 0, got: ${value}`);
  }
}

/**
 * Validate port number
 */
export function validatePort(value: number, fieldName: string): void {
  if (value <= 0 || value > 65535) {
    throw new Error(`${fieldName} must be between 1 and 65535, got: ${value}`);
  }
}
