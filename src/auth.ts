// @ichibase/auth — auth client for ichibase projects.
//
// Wraps /auth/* endpoints on the project's auth-svc. Token storage
// is the caller's job — this SDK is stateless.

import {
  type IchibaseConfig,
  type Result,
  asResult,
  resolveConfig,
  urlJoin,
} from './core.js';

// ── Response types — exported so callers can write typed handlers ─

export interface SignupResult {
  user_id: string;
  email: string;
  needs_verification: boolean;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserProfile {
  id: string;
  email: string;
  verified_at: string | null;
}

/** Auth client. */
export class Auth {
  constructor(
    private base: string,
    private key: string,
    private fetchFn: typeof fetch,
  ) {}

  private call<T>(
    path: string,
    opts: { method?: string; body?: unknown; auth?: string } = {},
  ): Promise<Result<T>> {
    // auth-svc requires the project (anon/service) key in the `apikey` header.
    // The end-user's access token — only when acting as a user (e.g. /me,
    // /logout) — goes in Authorization: Bearer.
    const headers: Record<string, string> = { apikey: this.key };
    if (opts.auth) headers['Authorization'] = `Bearer ${opts.auth}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return this.fetchFn(urlJoin(this.base, `/auth${path}`), {
      method: opts.method ?? 'POST',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }).then((res) => asResult<T>(res));
  }

  signup(input: { email: string; password: string }): Promise<Result<SignupResult>> {
    return this.call<SignupResult>('/signup', { body: input });
  }

  login(input: { email: string; password: string }): Promise<Result<LoginResult>> {
    return this.call<LoginResult>('/login', { body: input });
  }

  refresh(refresh_token: string): Promise<Result<RefreshResult>> {
    return this.call<RefreshResult>('/refresh', { body: { refresh_token } });
  }

  /** Get the user identified by the given access token (or the SDK's key if none given). */
  getUser(accessToken?: string): Promise<Result<UserProfile>> {
    return this.call<UserProfile>('/me', { method: 'GET', auth: accessToken });
  }

  logout(refresh_token: string, accessToken: string): Promise<Result<unknown>> {
    return this.call<unknown>('/logout', { body: { refresh_token }, auth: accessToken });
  }

  logoutAll(accessToken: string): Promise<Result<unknown>> {
    return this.call<unknown>('/logout-all', { auth: accessToken });
  }

  requestPasswordReset(email: string): Promise<Result<{ sent: boolean }>> {
    return this.call<{ sent: boolean }>('/password-reset/request', { body: { email } });
  }

  confirmPasswordReset(token: string, new_password: string): Promise<Result<{ reset: boolean }>> {
    return this.call<{ reset: boolean }>('/password-reset/confirm', {
      body: { token, new_password },
    });
  }

  verifyEmail(token: string): Promise<Result<{ verified: boolean }>> {
    return this.call<{ verified: boolean }>('/verify-email', { body: { token } });
  }

  verifyEmailOtp(email: string, code: string): Promise<Result<{ verified: boolean }>> {
    return this.call<{ verified: boolean }>('/verify-email/otp', { body: { email, code } });
  }

  resendVerification(email: string): Promise<Result<{ sent: boolean }>> {
    return this.call<{ sent: boolean }>('/verify-email/resend', { body: { email } });
  }

  // ── Passwordless login (OTP + magic link) ────────────────────────
  // Additive to email+password. The project must enable it (and configure
  // custom SMTP) under Settings → Passwordless login. One email may carry
  // an OTP code, a magic link, or both — whichever the project enabled.

  /**
   * Send the passwordless sign-in email. Always resolves successfully
   * (202 `{ sent: true }`) even for unknown emails — it never reveals
   * whether an account exists. A new email creates the account on first
   * verify. Finish with `verifyOtp` (the typed code) or `verifyMagicLink`
   * (the token from the tapped link).
   */
  signInWithOtp(input: { email: string }): Promise<Result<{ sent: boolean }>> {
    return this.call<{ sent: boolean }>('/login/passwordless/request', {
      body: { email: input.email },
    });
  }

  /**
   * Verify a passwordless OTP code and sign the user in. Returns the same
   * token pair as `login`. Codes are single-use and expire; repeated
   * failures surface as `invalid_code` / `too_many_attempts`.
   */
  verifyOtp(input: { email: string; code: string }): Promise<Result<LoginResult>> {
    return this.call<LoginResult>('/login/passwordless/verify', {
      body: { email: input.email, code: input.code },
    });
  }

  /**
   * Redeem a magic-link token and sign the user in. Pass the `token`
   * query-param from the magic URL the user tapped. Returns the same
   * token pair as `login`.
   */
  verifyMagicLink(token: string): Promise<Result<LoginResult>> {
    return this.call<LoginResult>('/login/magic', { body: { token } });
  }

  // ── Phase 2 (v0.3.x) — bearer-authed profile + session mgmt ──────

  /**
   * Update the user's metadata JSONB. **Full replacement** — to merge,
   * read `getUser()` first and pass the merged object.
   *
   *   await auth.updateUser(accessToken, { metadata: { theme: 'dark', tz: 'UTC' } });
   *
   * Server enforces an 8 KB cap on the encoded metadata.
   */
  updateUser(
    accessToken: string,
    patch: { metadata: Record<string, unknown> },
  ): Promise<Result<UpdatedUser>> {
    return this.call<UpdatedUser>('/me', {
      method: 'PATCH',
      body: { metadata: patch.metadata },
      auth: accessToken,
    });
  }

  /**
   * Change the user's password. Requires the current password — does
   * NOT use a reset token (that's `confirmPasswordReset`). On success,
   * existing access tokens KEEP working (short TTL); call `refresh()`
   * after to mint a new pair if you want a fresh access token.
   *
   * Returns `{ changed: true, hint: '...' }`.
   */
  changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<Result<{ changed: boolean; hint: string }>> {
    return this.call<{ changed: boolean; hint: string }>('/change-password', {
      body: { current_password: currentPassword, new_password: newPassword },
      auth: accessToken,
    });
  }

  /**
   * List the user's active refresh-token sessions (one row per
   * device / login). Returns up to 100, ordered by most-recently-used.
   * Each row includes the user-agent + IP captured at login so the
   * user can identify devices.
   */
  listSessions(accessToken: string): Promise<Result<{ sessions: SessionInfo[] }>> {
    return this.call<{ sessions: SessionInfo[] }>('/sessions', {
      method: 'GET',
      auth: accessToken,
    });
  }

  /**
   * Revoke a single session by its id. Idempotent — revoking a
   * session that's already revoked returns `{ revoked: true }`.
   * The session must belong to the bearer user (404 otherwise).
   */
  revokeSession(
    accessToken: string,
    sessionId: string,
  ): Promise<Result<{ revoked: boolean }>> {
    return this.call<{ revoked: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/revoke`, {
      auth: accessToken,
    });
  }
}

// ── Phase 2 response types ─────────────────────────────────────────

export interface UpdatedUser {
  id: string;
  email: string;
  email_verified: boolean;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface SessionInfo {
  id: string;
  user_agent: string | null;
  ip: string | null;
  issued_at: string;
  last_used_at: string;
  expires_at: string;
}

export function createAuth(opts: IchibaseConfig = {}): Auth {
  const cfg = resolveConfig(opts);
  return new Auth(cfg.url, cfg.key, cfg.fetchFn);
}
