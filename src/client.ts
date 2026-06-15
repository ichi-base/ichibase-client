// IchibaseClient — the single client a frontend app uses. Anon key only.
//
//   import { createClient } from '@ichibase/client';
//   const ichi = createClient('https://abc.ichibase.net', 'ich_pub_…');
//   const { data } = await ichi.from('posts').select('*');
//   await ichi.auth.login({ email, password });   // now acts AS the user
//   ichi.realtime.subscribe({ kind: 'postgres', table: 'posts' }, console.log);
//
// One config + one session shared across postgres / auth / mongo /
// realtime. After login, data calls automatically use the user's access token
// so your RLS / policies / realtime rules see them; logged out, they use the
// publishable anon key (role = anon).

import type { IchibaseConfig, Result } from './core.js';
import { Postgrest } from './postgrest.js';
import { Mongo } from './mongo.js';
import { Functions } from './functions.js';
import {
  Auth,
  type LoginResult,
  type SignupResult,
  type RefreshResult,
  type UserProfile,
} from './auth.js';
import { RealtimeClient } from './realtime.js';
import { defaultStorage, type SessionStorage } from './storage-adapter.js';

export interface Session {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds when the access token expires (best-effort, from expires_in). */
  expires_at?: number;
  user?: { id: string; email: string };
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

export interface ClientOptions {
  /** Custom fetch (SSR, testing). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Where to persist the session. Browsers pass `localStorage`. */
  storage?: SessionStorage;
  /** Key under which the session is persisted. */
  storageKey?: string;
  /** WebSocket constructor for realtime (non-global envs). */
  WebSocketImpl?: typeof WebSocket;
}

const DEFAULT_STORAGE_KEY = 'ichibase.session';

/** Auth surface with session management layered over the stateless Auth client. */
class SessionAuth {
  constructor(
    private inner: Auth,
    private client: IchibaseClient,
  ) {}

  async signup(input: { email: string; password: string }): Promise<Result<SignupResult>> {
    return this.inner.signup(input);
  }

  async login(input: { email: string; password: string }): Promise<Result<LoginResult>> {
    const res = await this.inner.login(input);
    if (res.data) {
      await this.client._setSession(
        {
          access_token: res.data.access_token,
          refresh_token: res.data.refresh_token,
          expires_at: expiresAt(res.data.expires_in),
          user: res.data.user,
        },
        'SIGNED_IN',
      );
    }
    return res;
  }

  async refresh(): Promise<Result<RefreshResult>> {
    const s = this.client.getSession();
    if (!s) return { data: null, error: { code: 'no_session', detail: 'not logged in', status: 401 } };
    const res = await this.inner.refresh(s.refresh_token);
    if (res.data) {
      await this.client._setSession(
        {
          access_token: res.data.access_token,
          refresh_token: res.data.refresh_token,
          expires_at: expiresAt(res.data.expires_in),
          user: s.user,
        },
        'TOKEN_REFRESHED',
      );
    }
    return res;
  }

  /** Current signed-in user (from the live access token), or null. */
  async getUser(): Promise<UserProfile | null> {
    const s = this.client.getSession();
    if (!s) return null;
    const res = await this.inner.getUser(s.access_token);
    return res.data;
  }

  async logout(): Promise<void> {
    const s = this.client.getSession();
    if (s) await this.inner.logout(s.refresh_token, s.access_token).catch(() => {});
    await this.client._setSession(null, 'SIGNED_OUT');
  }

  requestPasswordReset(email: string) {
    return this.inner.requestPasswordReset(email);
  }
  confirmPasswordReset(token: string, newPassword: string) {
    return this.inner.confirmPasswordReset(token, newPassword);
  }
  verifyEmail(token: string) {
    return this.inner.verifyEmail(token);
  }
  verifyEmailOtp(email: string, code: string) {
    return this.inner.verifyEmailOtp(email, code);
  }
  resendVerification(email: string) {
    return this.inner.resendVerification(email);
  }

  /** Hydrate the session from the storage adapter (call once at startup for async adapters). */
  async loadSession(): Promise<Session | null> {
    return this.client._loadSession();
  }
  /** Set the session directly (e.g. from your own SSR cookie). */
  async setSession(session: Session | null): Promise<void> {
    await this.client._setSession(session, session ? 'SIGNED_IN' : 'SIGNED_OUT');
  }
}

export class IchibaseClient {
  readonly url: string;
  /** Auth surface with session management. */
  readonly auth: SessionAuth;

  private anonKey: string;
  private fetchFn: typeof fetch;
  private sessionStore: SessionStorage;
  private storageKey: string;
  private session: Session | null = null;
  private listeners = new Set<(e: AuthEvent, s: Session | null) => void>();
  private _realtime: RealtimeClient | null = null;
  private wsImpl?: typeof WebSocket;

  constructor(url: string, anonKey: string, opts: ClientOptions = {}) {
    if (!url) throw new Error('ichibase: url is required');
    if (!anonKey) throw new Error('ichibase: anon key is required');
    // This is the CLIENT SDK — it must never carry the secret/service key.
    if (anonKey.startsWith('ich_admin_')) {
      throw new Error(
        'ichibase: @ichibase/client is anon-key only. ich_admin_ (service) keys bypass RLS — never ship them to a client. Use them server-side via the JSR SDKs.',
      );
    }
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    // Persistence is automatic: localStorage in the browser, in-memory
    // elsewhere. Pass `storage` to override (e.g. AsyncStorage on RN).
    this.sessionStore = opts.storage ?? defaultStorage();
    this.storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
    this.wsImpl = opts.WebSocketImpl;
    this.auth = new SessionAuth(new Auth(this.url, this.anonKey, this.fetchFn), this);

    // Auto-hydrate from a SYNCHRONOUS adapter (e.g. localStorage). Async
    // adapters (AsyncStorage) require an explicit `await auth.loadSession()`.
    try {
      const raw = this.sessionStore.getItem(this.storageKey);
      if (typeof raw === 'string') this.session = parseSession(raw);
    } catch {
      /* ignore */
    }
  }

  /** The bearer to send on data-plane calls: the user token if signed in, else the anon key. */
  private bearer(): string {
    return this.session?.access_token ?? this.anonKey;
  }

  private cfg(key: string): IchibaseConfig {
    return { url: this.url, key, fetch: this.fetchFn };
  }

  // ── PostgREST ──────────────────────────────────────────────────────
  /** Start a PostgREST query against a table or view. */
  from<T = Record<string, unknown>>(table: string) {
    return new Postgrest(this.url, this.bearer(), this.fetchFn).from<T>(table);
  }
  /** Call a Postgres stored procedure (RPC). */
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>, opts?: { schema?: string; count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    return new Postgrest(this.url, this.bearer(), this.fetchFn).rpc<T>(fn, args, opts);
  }

  // ── Storage ────────────────────────────────────────────────────────
  // Intentionally NOT exposed on the client. Storage tokens / presigned
  // upload URLs are minted server-side by the project owner (Edge Function +
  // service key) and handed to users — never minted from a client. See the
  // Storage docs. Public files are read directly from cdn.ichibase.net.

  // ── Mongo ──────────────────────────────────────────────────────────
  /** Mongo data client (apikey = anon; user token attached when signed in). */
  get mongo(): Mongo {
    const m = new Mongo(this.url, this.anonKey, this.fetchFn);
    return this.session ? m.asUser(this.session.access_token) : m;
  }

  // ── Edge Functions ─────────────────────────────────────────────────
  /** Invoke your deployed Edge Functions: `ichi.functions.invoke('name', { body })`. */
  get functions(): Functions {
    const f = new Functions(this.url, this.anonKey, this.fetchFn);
    return this.session ? f.asUser(this.session.access_token) : f;
  }

  // ── Realtime ───────────────────────────────────────────────────────
  get realtime(): RealtimeClient {
    if (!this._realtime) {
      this._realtime = new RealtimeClient({
        url: this.url,
        getToken: () => this.bearer(),
        WebSocketImpl: this.wsImpl,
      });
    }
    return this._realtime;
  }

  // ── Session ────────────────────────────────────────────────────────
  getSession(): Session | null {
    return this.session;
  }
  /** Subscribe to auth state changes. Returns an unsubscribe fn. */
  onAuthStateChange(cb: (event: AuthEvent, session: Session | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** @internal */
  async _setSession(session: Session | null, event: AuthEvent): Promise<void> {
    this.session = session;
    try {
      if (session) await this.sessionStore.setItem(this.storageKey, JSON.stringify(session));
      else await this.sessionStore.removeItem(this.storageKey);
    } catch {
      /* persistence is best-effort */
    }
    for (const l of this.listeners) l(event, session);
  }

  /** @internal */
  async _loadSession(): Promise<Session | null> {
    try {
      const raw = await this.sessionStore.getItem(this.storageKey);
      this.session = typeof raw === 'string' ? parseSession(raw) : null;
    } catch {
      this.session = null;
    }
    return this.session;
  }
}

export function createClient(url: string, anonKey: string, opts?: ClientOptions): IchibaseClient {
  return new IchibaseClient(url, anonKey, opts);
}

function expiresAt(expiresIn: number | undefined): number | undefined {
  if (!expiresIn) return undefined;
  return Math.floor(Date.now() / 1000) + expiresIn;
}

function parseSession(raw: string): Session | null {
  try {
    const s = JSON.parse(raw) as Session;
    return s && typeof s.access_token === 'string' ? s : null;
  } catch {
    return null;
  }
}
