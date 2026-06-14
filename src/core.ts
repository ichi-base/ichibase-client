// @ichibase/core — shared types + helpers for the SDK family.
//
// Service packages (@ichibase/postgrest, @ichibase/mongo, etc.) import
// from here. Customers typically don't import core directly — they go
// through a service package or the meta @ichibase/edge.

// ───────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────

/**
 * Configuration shared by every service package. All fields are
 * optional — when running inside an ichibase Edge Function, sane
 * defaults are read from env (ICHIBASE_PROJECT_URL +
 * ICHIBASE_SERVICE_KEY / ICHIBASE_ANON_KEY).
 */
export interface IchibaseConfig {
  /** Base URL like `https://abc.ichibase.net`. Defaults to ICHIBASE_PROJECT_URL. */
  url?: string;
  /** API key: ich_pub_<jwt> (anon) or ich_admin_<jwt> (service). Defaults to ICHIBASE_SERVICE_KEY then ICHIBASE_ANON_KEY. */
  key?: string;
  /** Optional fetch override (testing). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

/** Resolved config — same shape but every field is concrete. */
export interface ResolvedConfig {
  url: string;
  key: string;
  fetchFn: typeof fetch;
}

export interface IchibaseError {
  code: string;
  detail?: string;
  /** HTTP status. */
  status: number;
}

export type Result<T> = { data: T; error: null } | { data: null; error: IchibaseError };

// ───────────────────────────────────────────────────────────────────
// Env reader — handles Deno + Node + Bun
// ───────────────────────────────────────────────────────────────────

export function envGet(name: string): string | undefined {
  // Deno
  const dEnv = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  if (dEnv?.env?.get) return dEnv.env.get(name);
  // Node / Bun
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (nodeEnv) return nodeEnv[name];
  return undefined;
}

// ───────────────────────────────────────────────────────────────────
// URL + body helpers
// ───────────────────────────────────────────────────────────────────

export function urlJoin(base: string, path: string): string {
  return base.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
}

export async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function asResult<T>(res: Response): Promise<Result<T>> {
  if (res.ok) {
    return { data: (await parseBody(res)) as T, error: null };
  }
  const body = (await parseBody(res)) as { code?: string; detail?: string; message?: string } | null;
  return {
    data: null,
    error: {
      code: body?.code ?? `http_${res.status}`,
      detail: body?.detail ?? body?.message ?? `HTTP ${res.status}`,
      status: res.status,
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Config resolution
// ───────────────────────────────────────────────────────────────────

/**
 * Resolve a service-package config:
 *   1. Use whatever the caller passed
 *   2. Fall back to env (works inside Edge Functions automatically)
 *
 * Throws if neither produces a usable url + key — fast failure beats
 * a confusing fetch error 10 stack frames in.
 */
export function resolveConfig(opts: IchibaseConfig = {}): ResolvedConfig {
  const url = opts.url ?? envGet('ICHIBASE_PROJECT_URL');
  const key = opts.key ?? envGet('ICHIBASE_SERVICE_KEY') ?? envGet('ICHIBASE_ANON_KEY');
  if (!url) {
    throw new Error('ichibase: missing url (pass opts.url or set ICHIBASE_PROJECT_URL)');
  }
  if (!key) {
    throw new Error('ichibase: missing key (pass opts.key or set ICHIBASE_SERVICE_KEY / ICHIBASE_ANON_KEY)');
  }
  return {
    url,
    key,
    fetchFn: opts.fetch ?? globalThis.fetch.bind(globalThis),
  };
}

// ───────────────────────────────────────────────────────────────────
// Generic fetch wrapper — every service package's call layer ends
// here. Returns a Result<T>, never throws on HTTP errors.
// ───────────────────────────────────────────────────────────────────

export interface HttpCallOptions {
  method?: string;
  /** Bearer to use; defaults to caller-side default. */
  bearer?: string;
  /** JSON body — set Content-Type automatically. */
  body?: unknown;
  /** Extra headers (do NOT pass Authorization here — use `bearer`). */
  headers?: Record<string, string>;
}

export async function httpCall<T>(
  fetchFn: typeof fetch,
  url: string,
  opts: HttpCallOptions = {},
): Promise<Result<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetchFn(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return asResult<T>(res);
}
