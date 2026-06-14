// @ichibase/mongo — Mongo gateway client.
//
// Talks to the project's mongo-svc over HTTP. No native MongoDB
// driver is bundled — perfect for Edge Function cold-start budgets.

import {
  type IchibaseConfig,
  type Result,
  asResult,
  envGet,
  resolveConfig,
  urlJoin,
} from './core.js';

/** Per-collection client. */
export class MongoCollection {
  constructor(
    private base: string,
    private key: string,
    private collection: string,
    private fetchFn: typeof fetch,
    private userToken?: string,
  ) {}

  private async op<T>(
    op: string,
    body: Record<string, unknown>,
    query?: Record<string, string>,
  ): Promise<Result<T>> {
    let url = urlJoin(this.base, `/mongo/v1/${op}/${this.collection}`);
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    // mongo-gate wants the project key in the `apikey` header (the
    // publishable/secret key carries the anon/service_role). `Authorization:
    // Bearer` is reserved for the OPTIONAL end-user JWT, set via asUser().
    const headers: Record<string, string> = {
      'apikey': this.key,
      'Content-Type': 'application/json',
    };
    if (this.userToken) headers['Authorization'] = `Bearer ${this.userToken}`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return asResult<T>(res);
  }

  // Build the realtime query suffix for a write. `realtime: false` tells the
  // gateway to skip the realtime emit for THIS write (honoured only for
  // service_role / admin keys server-side). undefined/true emits as normal.
  private rt(realtime?: boolean): Record<string, string> | undefined {
    return realtime === false ? { realtime: 'false' } : undefined;
  }

  find(
    filter: Record<string, unknown> = {},
    opts: {
      projection?: Record<string, 0 | 1>;
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<Result<Record<string, unknown>[]>> {
    return this.op<Record<string, unknown>[]>('find', { filter, ...opts });
  }

  findOne(filter: Record<string, unknown> = {}): Promise<Result<Record<string, unknown> | null>> {
    return this.op<Record<string, unknown> | null>('findOne', { filter });
  }

  insertOne(
    doc: Record<string, unknown>,
    opts: { realtime?: boolean } = {},
  ): Promise<Result<{ insertedId: string }>> {
    return this.op<{ insertedId: string }>('insertOne', { doc }, this.rt(opts.realtime));
  }

  insertMany(
    docs: Record<string, unknown>[],
    opts: { realtime?: boolean } = {},
  ): Promise<Result<{ insertedIds: string[] }>> {
    return this.op<{ insertedIds: string[] }>('insertMany', { docs }, this.rt(opts.realtime));
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    opts: { upsert?: boolean; realtime?: boolean } = {},
  ): Promise<Result<{ matched: number; modified: number; upsertedId?: string }>> {
    const { realtime, ...rest } = opts;
    return this.op<{ matched: number; modified: number; upsertedId?: string }>(
      'updateOne',
      { filter, update, ...rest },
      this.rt(realtime),
    );
  }

  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    opts: { realtime?: boolean } = {},
  ): Promise<Result<{ matched: number; modified: number }>> {
    return this.op<{ matched: number; modified: number }>(
      'updateMany',
      { filter, update },
      this.rt(opts.realtime),
    );
  }

  deleteOne(
    filter: Record<string, unknown>,
    opts: { realtime?: boolean } = {},
  ): Promise<Result<{ deleted: number }>> {
    return this.op<{ deleted: number }>('deleteOne', { filter }, this.rt(opts.realtime));
  }

  deleteMany(
    filter: Record<string, unknown>,
    opts: { realtime?: boolean } = {},
  ): Promise<Result<{ deleted: number }>> {
    return this.op<{ deleted: number }>('deleteMany', { filter }, this.rt(opts.realtime));
  }

  count(filter: Record<string, unknown> = {}): Promise<Result<{ count: number }>> {
    return this.op<{ count: number }>('count', { filter });
  }

  aggregate(pipeline: Record<string, unknown>[]): Promise<Result<Record<string, unknown>[]>> {
    return this.op<Record<string, unknown>[]>('aggregate', { pipeline });
  }

  // ── Phase 2 (v0.3.x) operations ────────────────────────────────

  /**
   * Atomic find-and-update. Returns the matched document (post-update
   * by default; pass `returnDocument: 'before'` for the pre-update
   * snapshot). Honours upsert; on upsert with no match the returned
   * doc is null.
   *
   *   await users.findOneAndUpdate(
   *     { _id: 1 },
   *     { $inc: { visits: 1 } },
   *     { returnDocument: 'after' },
   *   );
   */
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    opts: {
      projection?: Record<string, 0 | 1>;
      sort?: Record<string, 1 | -1>;
      upsert?: boolean;
      /** Default 'after'. Picks which snapshot of the doc to return. */
      returnDocument?: 'before' | 'after';
      realtime?: boolean;
    } = {},
  ): Promise<Result<{ doc: Record<string, unknown> | null }>> {
    return this.op<{ doc: Record<string, unknown> | null }>('findOneAndUpdate', {
      filter,
      update,
      ...(opts.projection ? { projection: opts.projection } : {}),
      ...(opts.sort ? { sort: opts.sort } : {}),
      ...(opts.upsert !== undefined ? { upsert: opts.upsert } : {}),
      ...(opts.returnDocument ? { return_document: opts.returnDocument } : {}),
    }, this.rt(opts.realtime));
  }

  /** Atomic find-and-delete. Returns the deleted document or null. */
  findOneAndDelete(
    filter: Record<string, unknown>,
    opts: {
      projection?: Record<string, 0 | 1>;
      sort?: Record<string, 1 | -1>;
      realtime?: boolean;
    } = {},
  ): Promise<Result<{ doc: Record<string, unknown> | null }>> {
    return this.op<{ doc: Record<string, unknown> | null }>('findOneAndDelete', {
      filter,
      ...(opts.projection ? { projection: opts.projection } : {}),
      ...(opts.sort ? { sort: opts.sort } : {}),
    }, this.rt(opts.realtime));
  }

  /**
   * Replace a single matched document with a full replacement.
   * Unlike updateOne, the body is the new document — no $set / $inc.
   * Keys starting with `$` are rejected.
   */
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    opts: { upsert?: boolean; realtime?: boolean } = {},
  ): Promise<Result<{ matched: number; modified: number; upserted: number; upserted_id?: unknown }>> {
    return this.op<{ matched: number; modified: number; upserted: number; upserted_id?: unknown }>(
      'replaceOne',
      { filter, replacement, ...(opts.upsert !== undefined ? { upsert: opts.upsert } : {}) },
      this.rt(opts.realtime),
    );
  }

  /**
   * Batched write — multiple ops in one HTTP round trip. Each op is
   * one of insertOne / updateOne / updateMany / replaceOne /
   * deleteOne / deleteMany. The whole batch shares one policy check.
   *
   *   await users.bulkWrite([
   *     { op: 'insertOne', doc: { name: 'a' } },
   *     { op: 'updateOne', filter: { _id: 1 }, update: { $set: { name: 'b' } } },
   *     { op: 'deleteOne', filter: { _id: 2 } },
   *   ]);
   *
   * Set `ordered: true` to stop on first error; default is unordered
   * (continue past errors). Subject to your plan's mongo_max_docs cap.
   */
  bulkWrite(
    ops: BulkWriteOp[],
    opts: { ordered?: boolean; realtime?: boolean } = {},
  ): Promise<Result<{
    inserted: number;
    matched: number;
    modified: number;
    deleted: number;
    upserted: number;
    upserted_ids: Record<string, unknown>;
  }>> {
    return this.op<{
      inserted: number;
      matched: number;
      modified: number;
      deleted: number;
      upserted: number;
      upserted_ids: Record<string, unknown>;
    }>('bulkWrite', {
      ops,
      ...(opts.ordered !== undefined ? { ordered: opts.ordered } : {}),
    }, this.rt(opts.realtime));
  }

  /**
   * Distinct values of a field across docs matching filter.
   *
   *   await events.distinct('category', { tenant_id: 'acme' });
   *   // → { data: { values: ['ui', 'api', 'cron'], truncated: false } }
   */
  distinct(
    field: string,
    filter: Record<string, unknown> = {},
  ): Promise<Result<{ values: unknown[]; truncated: boolean }>> {
    return this.op<{ values: unknown[]; truncated: boolean }>('distinct', { field, filter });
  }
}

// ───────────────────────────────────────────────────────────────────
// bulkWrite op shapes — exported so callers get static typing on the
// operation discriminator field.
// ───────────────────────────────────────────────────────────────────

export type BulkWriteOp =
  | { op: 'insertOne'; doc: Record<string, unknown> }
  | { op: 'updateOne'; filter: Record<string, unknown>; update: Record<string, unknown>; upsert?: boolean }
  | { op: 'updateMany'; filter: Record<string, unknown>; update: Record<string, unknown>; upsert?: boolean }
  | { op: 'replaceOne'; filter: Record<string, unknown>; replacement: Record<string, unknown>; upsert?: boolean }
  | { op: 'deleteOne'; filter: Record<string, unknown> }
  | { op: 'deleteMany'; filter: Record<string, unknown> };

/** Top-level mongo client. Use `.collection(name)`. */
export class Mongo {
  constructor(
    private readonly base: string,
    private readonly key: string,
    private readonly fetchFn: typeof fetch,
    private readonly userToken?: string,
  ) {}

  /**
   * Return a Mongo client that acts AS the signed-in end user: their JWT is
   * sent as `Authorization: Bearer`, so your `_mongo_policy` and realtime rules
   * see the real `$auth.uid` / role. The project key still gates anon vs
   * service_role. Pass the access token you got from ichibase auth.
   */
  asUser(token: string): Mongo {
    return new Mongo(this.base, this.key, this.fetchFn, token);
  }

  collection(name: string): MongoCollection {
    return new MongoCollection(this.base, this.key, name, this.fetchFn, this.userToken);
  }
}

/**
 * Factory. Honours `ICHIBASE_MONGO_URL` if set (internal gateway in
 * Edge Functions), else uses the project base URL.
 */
export function createMongo(opts: IchibaseConfig = {}): Mongo {
  const cfg = resolveConfig(opts);
  const base = envGet('ICHIBASE_MONGO_URL') ?? cfg.url;
  return new Mongo(base, cfg.key, cfg.fetchFn);
}
