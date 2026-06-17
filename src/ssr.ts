// @ichibase/client/ssr — Supabase-style helpers for cookie-based sessions in
// SSR frameworks (Next.js App Router, Remix, SvelteKit, …).
//
//   // Client Components / browser:
//   import { createBrowserClient } from '@ichibase/client/ssr';
//   export const ichi = createBrowserClient(url, anonKey);
//
//   // Server Components / Server Actions / Route Handlers / middleware:
//   import { createServerClient } from '@ichibase/client/ssr';
//   const ichi = createServerClient(url, anonKey, { cookies });
//
// The session lives in ONE cookie (default `ichibase.session`) so the browser
// and the server share it. The cookie is NOT httpOnly — the browser client
// reads it to attach the user's token and to self-refresh (exactly the model
// @supabase/ssr uses). Pair `createServerClient` with middleware that calls
// `auth.getUser()` so an expired access token is refreshed and the fresh cookie
// is written to the response (Server Components can't set cookies themselves).
//
// This module imports NOTHING framework-specific — the caller supplies the
// cookie accessors, so the same code works in Next/Remix/SvelteKit/etc.

import { createClient, type IchibaseClient, type ClientOptions } from './client.js';
import type { SessionStorage } from './storage-adapter.js';

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  sameSite?: 'strict' | 'lax' | 'none' | boolean;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface Cookie {
  name: string;
  value: string;
}

export interface CookieToSet extends Cookie {
  options?: CookieOptions;
}

/** The cookie bridge the caller provides — mirrors `@supabase/ssr`. */
export interface CookieMethods {
  /** Return all request cookies (name/value). */
  getAll(): Cookie[];
  /** Persist the given cookies (name/value/options) onto the response. */
  setAll(cookies: CookieToSet[]): void;
}

const DEFAULT_COOKIE_NAME = 'ichibase.session';
// ~400 days — Chrome caps cookie max-age at 400d. The refresh token (not the
// cookie) is the real session lifetime.
const MAX_AGE = 400 * 24 * 60 * 60;

// ── base64url codec ──────────────────────────────────────────────────
// The session JSON contains `{ } " : ,` which aren't safe in a raw cookie
// value, so we store it base64url-encoded. base64url chars (A–Z a–z 0–9 - _)
// are ALSO URL-unreserved, so the value is invariant under any
// encode/decodeURIComponent a runtime's cookie layer might apply — which
// sidesteps the classic browser-writes-vs-server-reads encoding mismatch.
// Uses only globals available in browsers, Node 18+, Deno, Bun, and edge.
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Bridge the SDK's single-key SessionStorage onto a getAll/setAll cookie API.
// The whole session JSON lives in one cookie named `key`.
class CookieStorage implements SessionStorage {
  constructor(
    private cookies: CookieMethods,
    private options: CookieOptions,
  ) {}
  getItem(key: string): string | null {
    const hit = this.cookies.getAll().find((c) => c.name === key);
    if (!hit || !hit.value) return null;
    try {
      return fromBase64Url(hit.value);
    } catch {
      return null;
    }
  }
  setItem(key: string, value: string): void {
    this.cookies.setAll([
      { name: key, value: toBase64Url(value), options: { ...this.options, maxAge: MAX_AGE } },
    ]);
  }
  removeItem(key: string): void {
    this.cookies.setAll([{ name: key, value: '', options: { ...this.options, maxAge: 0 } }]);
  }
}

// ── Server client ────────────────────────────────────────────────────
export interface ServerClientOptions extends Omit<ClientOptions, 'storage'> {
  /** Cookie accessors bound to the current request/response. */
  cookies: CookieMethods;
  /** Override the cookie attributes (path/sameSite/secure/domain/…). */
  cookieOptions?: CookieOptions;
}

const SERVER_DEFAULTS: CookieOptions = { path: '/', sameSite: 'lax', secure: true };

/**
 * Create a client for the server (Server Components, Server Actions, Route
 * Handlers, middleware). The session is read from / written to cookies via the
 * `cookies` you pass — supply an already-resolved cookie store so the accessors
 * are synchronous (the client hydrates its session in the constructor).
 *
 * In a Server Component you can only READ cookies, so writes (e.g. a refresh)
 * are no-ops there — run `auth.getUser()` in middleware (where cookies CAN be
 * written) to keep the token fresh.
 */
export function createServerClient(
  url: string,
  anonKey: string,
  opts: ServerClientOptions,
): IchibaseClient {
  const { cookies, cookieOptions, storageKey, ...rest } = opts;
  const name = storageKey ?? DEFAULT_COOKIE_NAME;
  const storage = new CookieStorage(cookies, { ...SERVER_DEFAULTS, ...cookieOptions });
  return createClient(url, anonKey, { ...rest, storageKey: name, storage });
}

// ── Browser client ───────────────────────────────────────────────────
let browserSingleton: IchibaseClient | undefined;
let browserKey: string | undefined;

/**
 * Create a client for the browser (Client Components). Returns a singleton per
 * `(url, anonKey)` so the whole component tree shares one session + realtime
 * socket. The session is stored in a (non-httpOnly) cookie so the server can
 * read it too.
 */
export function createBrowserClient(
  url: string,
  anonKey: string,
  opts: Omit<ClientOptions, 'storage'> = {},
): IchibaseClient {
  const id = `${url}::${anonKey}`;
  if (browserSingleton && browserKey === id) return browserSingleton;
  const name = opts.storageKey ?? DEFAULT_COOKIE_NAME;
  const storage = new CookieStorage(documentCookieMethods(), {
    path: '/',
    sameSite: 'lax',
    secure: isHttps(),
  });
  browserSingleton = createClient(url, anonKey, { ...opts, storageKey: name, storage });
  browserKey = id;
  return browserSingleton;
}

function isHttps(): boolean {
  try {
    return typeof location !== 'undefined' && location.protocol === 'https:';
  } catch {
    return false;
  }
}

// `document.cookie` getAll/setAll — browser only.
function documentCookieMethods(): CookieMethods {
  return {
    getAll() {
      if (typeof document === 'undefined' || !document.cookie) return [];
      return document.cookie
        .split('; ')
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf('=');
          return eq === -1
            ? { name: pair, value: '' }
            : { name: pair.slice(0, eq), value: pair.slice(eq + 1) };
        });
    },
    setAll(cookies) {
      if (typeof document === 'undefined') return;
      for (const { name, value, options } of cookies) {
        document.cookie = serializeCookie(name, value, options);
      }
    },
  };
}

function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  let s = `${name}=${value}`;
  if (o.maxAge !== undefined) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.expires) s += `; Expires=${o.expires.toUTCString()}`;
  s += `; Path=${o.path ?? '/'}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  if (o.sameSite) {
    const v = o.sameSite === true ? 'Strict' : String(o.sameSite);
    s += `; SameSite=${v.charAt(0).toUpperCase()}${v.slice(1)}`;
  }
  if (o.secure) s += '; Secure';
  // httpOnly is intentionally ignored: JS can't set an httpOnly cookie, and the
  // browser client must be able to read this one.
  return s;
}

// Re-export the client type for convenience so apps can type their helpers
// without a second import from the main entry.
export type { IchibaseClient } from './client.js';
