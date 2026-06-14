// @ichibase/client — Edge Functions invoke helper. Saves you writing a raw
// fetch to /functions/<name>: it sets the apikey, attaches the signed-in user's
// token, JSON-encodes the body, and returns a typed Result.

import { type Result, asResult, urlJoin } from './core.js';

export interface InvokeOptions {
  /** HTTP method. Defaults to POST. */
  method?: string;
  /**
   * Request body. A string / Blob / FormData / ArrayBuffer / typed array is
   * sent as-is; anything else is JSON-encoded (with Content-Type json).
   */
  body?: unknown;
  /** Extra headers (don't set Authorization here — sign in instead). */
  headers?: Record<string, string>;
  /** Extra path appended after the function name, e.g. '/items/42'. */
  path?: string;
}

export class Functions {
  constructor(
    private base: string,
    private key: string, // project (anon) key — sent as the `apikey` header
    private fetchFn: typeof fetch,
    private userToken?: string, // end-user access token (Authorization: Bearer)
  ) {}

  /** Return a Functions client that calls AS a specific end user. */
  asUser(accessToken: string): Functions {
    return new Functions(this.base, this.key, this.fetchFn, accessToken);
  }

  /**
   * Invoke an Edge Function by name.
   *
   *   const { data, error } = await ichi.functions.invoke('hello', { body: { name: 'world' } });
   */
  async invoke<T = unknown>(name: string, opts: InvokeOptions = {}): Promise<Result<T>> {
    const url = urlJoin(this.base, `/functions/${name}${opts.path ?? ''}`);
    const headers: Record<string, string> = { apikey: this.key, ...opts.headers };
    if (this.userToken) headers['Authorization'] = `Bearer ${this.userToken}`;

    let body: BodyInit | undefined;
    const b = opts.body;
    if (b !== undefined) {
      const isRaw =
        typeof b === 'string' ||
        b instanceof ArrayBuffer ||
        ArrayBuffer.isView(b) ||
        (typeof Blob !== 'undefined' && b instanceof Blob) ||
        (typeof FormData !== 'undefined' && b instanceof FormData);
      if (isRaw) {
        body = b as BodyInit;
      } else {
        body = JSON.stringify(b);
        if (!('Content-Type' in headers)) headers['Content-Type'] = 'application/json';
      }
    }

    const res = await this.fetchFn(url, {
      method: opts.method ?? 'POST',
      headers,
      body,
    });
    return asResult<T>(res);
  }
}
