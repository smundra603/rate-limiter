import { getEnv } from '../env-helpers';

/**
 * JwtConfig - JWT authentication configuration
 *
 * Environment variables:
 * - JWT_SECRET: Secret key for JWT verification (optional)
 * - JWT_HEADER: Header name for JWT token (default: 'authorization')
 */
export class JwtConfig {
  readonly secret: string | undefined;
  readonly header: string;

  constructor() {
    this.secret = process.env.JWT_SECRET;
    this.header = getEnv('JWT_HEADER', 'authorization');
    this.validate();
  }

  /**
   * Get header name in lowercase for case-insensitive comparison
   */
  get headerLowerCase(): string {
    return this.header.toLowerCase();
  }

  /**
   * Check if JWT secret is configured
   */
  get hasSecret(): boolean {
    return !!this.secret && this.secret.trim().length > 0;
  }

  protected validate(): void {
    if (this.header.trim().length === 0) {
      throw new Error('JWT_HEADER must not be empty');
    }
  }
}
