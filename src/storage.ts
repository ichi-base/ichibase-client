// @ichibase/storage — storage client for ichibase projects.
//
// Mints signed read URLs (verified by the CF Worker) and R2 presigned
// PUT URLs. The actual GET/PUT happens out-of-band; this SDK only
// brokers the URLs.

import {
  type IchibaseConfig,
  type Result,
  asResult,
  resolveConfig,
  urlJoin,
} from './core.js';

export interface SignedReadUrl {
  url: string;
  jti: string;
  exp: number;
}

export interface SignedPutUrl {
  url: string;
  expires_in: number;
}

/** Per-bucket handle. */
export class StorageBucket {
  constructor(
    private base: string,
    private key: string,
    private bucket: string,
    private fetchFn: typeof fetch,
  ) {}

  /** Mint a short-lived (10s default) read URL. */
  async getUrl(
    path: string,
    opts: { userId?: string; ttlSeconds?: number } = {},
  ): Promise<Result<SignedReadUrl>> {
    const res = await this.fetchFn(urlJoin(this.base, '/storage/get-url'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucket: this.bucket,
        path,
        ...(opts.userId ? { user_id: opts.userId } : {}),
        ...(opts.ttlSeconds ? { ttl_seconds: opts.ttlSeconds } : {}),
      }),
    });
    return asResult<SignedReadUrl>(res);
  }

  /** Mint a single-use 5-minute R2 presigned PUT URL. */
  async getPutUrl(
    path: string,
    opts: { contentType: string; contentLength: number },
  ): Promise<Result<SignedPutUrl>> {
    const res = await this.fetchFn(urlJoin(this.base, '/storage/get-put-url'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucket: this.bucket,
        path,
        content_type: opts.contentType,
        content_length: opts.contentLength,
      }),
    });
    return asResult<SignedPutUrl>(res);
  }

  // ─── Phase 2 (v0.3.x) operations ───────────────────────────────────

  /**
   * Upload a file in one call — convenience helper that wraps
   * `getPutUrl` + the actual PUT. Returns the path on success.
   *
   *   await storage.from('avatars').upload(`u/${id}.png`, fileBlob);
   *
   * `body` accepts anything fetch's body does (Blob, ArrayBuffer, ReadableStream, string).
   * `contentType` defaults to the blob's type, else 'application/octet-stream'.
   * Throws if `body` doesn't have a knowable size — pass `contentLength` explicitly.
   */
  async upload(
    path: string,
    body: Blob | ArrayBuffer | ArrayBufferView | string,
    opts: { contentType?: string; contentLength?: number } = {},
  ): Promise<Result<{ path: string }>> {
    const contentType = opts.contentType
      ?? (body instanceof Blob ? body.type || 'application/octet-stream' : 'application/octet-stream');
    const contentLength = opts.contentLength ?? guessLength(body);
    if (contentLength === undefined) {
      return {
        data: null,
        error: {
          code: 'unknown_body_size',
          detail: 'upload(): body has no knowable byte length; pass opts.contentLength',
          status: 0,
        },
      };
    }
    const signed = await this.getPutUrl(path, { contentType, contentLength });
    if (signed.error) return { data: null, error: signed.error };
    const putRes = await this.fetchFn(signed.data.url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) },
      body: body instanceof ArrayBuffer ? new Uint8Array(body) : (body as BodyInit),
    });
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => `HTTP ${putRes.status}`);
      return {
        data: null,
        error: { code: `r2_put_${putRes.status}`, detail, status: putRes.status },
      };
    }
    return { data: { path }, error: null };
  }

  /**
   * Download an object's bytes in one call. Internally mints a short
   * read URL then fetches it.
   */
  async download(
    path: string,
    opts: { userId?: string; ttlSeconds?: number } = {},
  ): Promise<Result<Blob>> {
    const signed = await this.getUrl(path, opts);
    if (signed.error) return { data: null, error: signed.error };
    const res = await this.fetchFn(signed.data.url);
    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      return {
        data: null,
        error: { code: `r2_get_${res.status}`, detail, status: res.status },
      };
    }
    return { data: await res.blob(), error: null };
  }

  /**
   * Delete an object. Idempotent — deleting a non-existent path is
   * not an error; you get `{ deleted: false, bytes_freed: 0 }`.
   * Decrements the project's storage_bytes counter atomically.
   */
  async delete(path: string): Promise<Result<{ deleted: boolean; bytes_freed: number }>> {
    const res = await this.fetchFn(urlJoin(this.base, '/storage/delete'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket: this.bucket, path }),
    });
    return asResult<{ deleted: boolean; bytes_freed: number }>(res);
  }

  /**
   * HEAD an object — fast existence + metadata check.
   * Returns `{ exists: false }` when missing; otherwise size +
   * content_type + etag + last_modified.
   */
  async head(path: string): Promise<Result<ObjectHead>> {
    const res = await this.fetchFn(urlJoin(this.base, '/storage/head'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket: this.bucket, path }),
    });
    return asResult<ObjectHead>(res);
  }

  /**
   * List objects under a prefix. Paginated — pass `cursor` from the
   * previous response to continue. `limit` is 1–1000, default 100.
   *
   *   const { data } = await storage.from('avatars').list({ prefix: 'u/' });
   *   for (const obj of data.objects) { ... }
   *   if (data.cursor) { ... fetch next page ... }
   */
  async list(
    opts: { prefix?: string; limit?: number; cursor?: string } = {},
  ): Promise<Result<ListResult>> {
    const res = await this.fetchFn(urlJoin(this.base, '/storage/list'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucket: this.bucket,
        ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
      }),
    });
    return asResult<ListResult>(res);
  }

  /**
   * Move (rename) an object. Implemented as copy-then-delete on R2.
   * Source must exist (returns 404 otherwise). Same-bucket only.
   */
  async move(from: string, to: string): Promise<Result<{ moved: boolean; size: number }>> {
    const res = await this.fetchFn(urlJoin(this.base, '/storage/move'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket: this.bucket, from, to }),
    });
    return asResult<{ moved: boolean; size: number }>(res);
  }
}

/** Object metadata returned by `.head()`. */
export type ObjectHead =
  | { exists: false }
  | {
      exists: true;
      size: number;
      content_type?: string;
      etag?: string;
      last_modified?: string;
    };

/** Single entry in a `.list()` response. */
export interface ListedObject {
  /** Path relative to the bucket (the way you uploaded it). */
  path: string;
  size: number;
  etag?: string;
  last_modified?: string;
}

/** Result envelope for `.list()`. */
export interface ListResult {
  objects: ListedObject[];
  /** Opaque cursor for the next page; null when no more pages. */
  cursor: string | null;
}

// ───────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────

function guessLength(body: Blob | ArrayBuffer | ArrayBufferView | string): number | undefined {
  if (typeof body === 'string') {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

/** Top-level storage client. */
export class Storage {
  constructor(
    private readonly base: string,
    private readonly key: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  from(bucket: string): StorageBucket {
    return new StorageBucket(this.base, this.key, bucket, this.fetchFn);
  }
}

export function createStorage(opts: IchibaseConfig = {}): Storage {
  const cfg = resolveConfig(opts);
  return new Storage(cfg.url, cfg.key, cfg.fetchFn);
}
