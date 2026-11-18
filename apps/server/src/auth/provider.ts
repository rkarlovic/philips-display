import type { LoginRequest } from '@slidecast/shared';

export type AuthFailure = 'not_registered' | 'password_required' | 'invalid_credentials';

export type AuthResult = { ok: true; userId: number } | { ok: false; error: AuthFailure };

/**
 * Login goes through this interface so passwords for faculty users, or SSO
 * (OIDC/SAML, e.g. AAI@EduHr), can be added later without touching routes or authz.
 */
export interface AuthProvider {
  readonly id: string;
  authenticate(input: LoginRequest): Promise<AuthResult>;
}
