// @ichibase/postgrest — full-coverage PostgREST builder for ichibase.
//
// Chainable PostgREST query builder. Awaiting any chain triggers the
// HTTP request (PromiseLike). Shape modifiers (single, maybeSingle,
// csv, count) change the type of the resolved value so customers
// keep a real, statically-checked Result<T>.
//
// Auth uses Bearer with the SDK's key (or a per-user access token via
// .asUser()).

import {
  type IchibaseConfig,
  type Result,
  asResult,
  parseBody,
  resolveConfig,
  urlJoin,
} from './core.js';

// ───────────────────────────────────────────────────────────────────
// Internal state — shared by every method on a chain
// ───────────────────────────────────────────────────────────────────

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'HEAD';

interface BuilderState {
  base: string;
  key: string;
  table: string;
  fetchFn: typeof fetch;
  /** Encoded "col=op.val" pieces. */
  filters: string[];
  body?: unknown;
  method?: Method;
  returnRepresentation?: boolean;
  /** PostgREST "object+json" Accept — enforce exactly-one. */
  acceptSingle?: boolean;
  /** Return first row of an array or null; no server-side enforcement. */
  acceptMaybeSingle?: boolean;
  /** Return CSV text instead of JSON. */
  acceptCsv?: boolean;
  /** Count mode for Prefer header. Also makes the result a {rows,count}. */
  countMode?: 'exact' | 'planned' | 'estimated';
  /** Upsert resolution. */
  upsertResolution?: 'merge-duplicates' | 'ignore-duplicates';
  /** Columns for on_conflict on upsert. */
  onConflict?: string;
  /** HTTP Range header values (server returns 206 + Content-Range). */
  rangeFrom?: number;
  rangeTo?: number;
  /** Non-public schema name (Accept-Profile / Content-Profile header). */
  schemaName?: string;
  /** Free-form headers the caller wants to override. */
  extraHeaders?: Record<string, string>;
}

// ───────────────────────────────────────────────────────────────────
// QueryBuilder — generic over T (row type) and R (resolved value shape).
// Shape modifiers re-type the builder so awaiting returns the right thing.
// ───────────────────────────────────────────────────────────────────

/** What `.count()` resolves to. */
export interface CountedResult<T> {
  rows: T[];
  count: number;
}

/** PostgREST filter operators usable with `not()` / `filter()` escape hatches. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'match'
  | 'imatch'
  | 'in'
  | 'is'
  | 'isdistinct'
  | 'fts'
  | 'plfts'
  | 'phfts'
  | 'wfts'
  | 'cs'
  | 'cd'
  | 'ov'
  | 'sl'
  | 'sr'
  | 'nxr'
  | 'nxl'
  | 'adj';

export class QueryBuilder<T, R = T[]> implements PromiseLike<Result<R>> {
  // deno-lint-ignore no-explicit-any
  constructor(private state: BuilderState) {}

  // ── Eq family ─────────────────────────────────────────────────────

  eq(col: string, val: unknown): this {
    return this.appendFilter(col, 'eq', val);
  }
  neq(col: string, val: unknown): this {
    return this.appendFilter(col, 'neq', val);
  }
  gt(col: string, val: unknown): this {
    return this.appendFilter(col, 'gt', val);
  }
  gte(col: string, val: unknown): this {
    return this.appendFilter(col, 'gte', val);
  }
  lt(col: string, val: unknown): this {
    return this.appendFilter(col, 'lt', val);
  }
  lte(col: string, val: unknown): this {
    return this.appendFilter(col, 'lte', val);
  }

  // ── Pattern / text search ─────────────────────────────────────────

  like(col: string, pattern: string): this {
    return this.appendFilter(col, 'like', pattern);
  }
  ilike(col: string, pattern: string): this {
    return this.appendFilter(col, 'ilike', pattern);
  }
  /** Full-text search (PostgreSQL @@). `mode` picks the parser. */
  fts(col: string, query: string, opts: { config?: string; type?: 'plain' | 'phrase' | 'websearch' } = {}): this {
    const op = opts.type === 'phrase' ? 'phfts' : opts.type === 'websearch' ? 'wfts' : 'plfts';
    const cfg = opts.config ? `(${opts.config})` : '';
    this.state.filters.push(`${col}=${op}${cfg}.${encodeURIComponent(query)}`);
    return this;
  }

  // ── Membership / null / boolean ───────────────────────────────────

  in(col: string, values: unknown[]): this {
    this.state.filters.push(
      `${col}=in.(${values.map((v) => encodeURIComponent(String(v))).join(',')})`,
    );
    return this;
  }
  /** is.null, is.true, is.false, is.unknown */
  is(col: string, val: null | boolean | 'unknown'): this {
    const v = val === null ? 'null' : val === 'unknown' ? 'unknown' : String(val);
    this.state.filters.push(`${col}=is.${v}`);
    return this;
  }

  // ── Array / range operators ───────────────────────────────────────

  /** array/jsonb `@>` — col contains the given values. */
  contains(col: string, val: unknown): this {
    return this.appendFilter(col, 'cs', this.formatArrayOrJson(val));
  }
  /** `<@` — col is contained by the given values. */
  containedBy(col: string, val: unknown): this {
    return this.appendFilter(col, 'cd', this.formatArrayOrJson(val));
  }
  /** `&&` — arrays/ranges overlap. */
  overlaps(col: string, val: unknown): this {
    return this.appendFilter(col, 'ov', this.formatArrayOrJson(val));
  }
  /** Range strictly left of (`<<`). */
  rangeLt(col: string, val: string): this {
    return this.appendFilter(col, 'sl', val);
  }
  /** Range strictly right of (`>>`). */
  rangeGt(col: string, val: string): this {
    return this.appendFilter(col, 'sr', val);
  }
  /** Range does not extend to the right of (`&<`). */
  rangeLte(col: string, val: string): this {
    return this.appendFilter(col, 'nxr', val);
  }
  /** Range does not extend to the left of (`&>`). */
  rangeGte(col: string, val: string): this {
    return this.appendFilter(col, 'nxl', val);
  }
  /** Adjacent ranges (`-|-`). */
  rangeAdjacent(col: string, val: string): this {
    return this.appendFilter(col, 'adj', val);
  }

  // ── Logical / negation ────────────────────────────────────────────

  /** Negate a filter: `not(col, 'gt', 18)` → `col=not.gt.18`. */
  not(col: string, op: FilterOp, val: unknown): this {
    this.state.filters.push(`${col}=not.${op}.${encodeURIComponent(String(val))}`);
    return this;
  }
  /**
   * Logical OR. Pass a comma-separated filter string in PostgREST syntax:
   *   .or('age.gt.18,status.eq.active')
   *   .or('and(status.eq.paid,total.gt.100),user_id.eq.42')
   */
  or(filters: string): this {
    this.state.filters.push(`or=(${encodeURIComponent(filters)})`);
    return this;
  }
  /** Logical AND group (rarely needed — multiple chained filters are already ANDed). */
  and(filters: string): this {
    this.state.filters.push(`and=(${encodeURIComponent(filters)})`);
    return this;
  }
  /** Multiple eq() in one call: `.match({ status: 'paid', user_id: 42 })`. */
  match(query: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(query)) this.eq(k, v);
    return this;
  }
  /** Escape hatch — any column/op/value combo PostgREST supports. */
  filter(col: string, op: FilterOp, val: unknown): this {
    return this.appendFilter(col, op, val);
  }

  // ── Ordering & paging ─────────────────────────────────────────────

  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    const dir = opts.ascending === false ? 'desc' : 'asc';
    const nulls = opts.nullsFirst === true ? '.nullsfirst' : opts.nullsFirst === false ? '.nullslast' : '';
    this.state.filters.push(`order=${encodeURIComponent(col + '.' + dir + nulls)}`);
    return this;
  }
  limit(n: number): this {
    this.state.filters.push(`limit=${n}`);
    return this;
  }
  offset(n: number): this {
    this.state.filters.push(`offset=${n}`);
    return this;
  }
  /**
   * HTTP Range pagination — `from` and `to` are inclusive 0-based.
   * Server returns 206 + Content-Range: from-to/total.
   * Pairs naturally with `.count()`.
   */
  range(from: number, to: number): this {
    this.state.rangeFrom = from;
    this.state.rangeTo = to;
    return this;
  }

  // ── Column projection & embeds ────────────────────────────────────

  /**
   * Pick columns and embed related resources:
   *   .select('id, total, customer:profiles(name, email)')
   * Defaults to '*'.
   */
  select(cols = '*'): this {
    this.state.method = this.state.method ?? 'GET';
    this.state.filters.push(`select=${encodeURIComponent(cols)}`);
    return this;
  }

  // ── Schema (for non-public) ───────────────────────────────────────

  /** Target a non-public schema for this call. */
  schema(name: string): this {
    this.state.schemaName = name;
    return this;
  }

  // ── Write ops ─────────────────────────────────────────────────────

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.state.method = 'POST';
    this.state.body = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  /**
   * INSERT ... ON CONFLICT ... DO UPDATE / DO NOTHING.
   *   .upsert([row1, row2], { onConflict: 'email' })
   *   .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
   */
  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    opts: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ): this {
    this.state.method = 'POST';
    this.state.body = Array.isArray(rows) ? rows : [rows];
    this.state.upsertResolution = opts.ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates';
    if (opts.onConflict) this.state.onConflict = opts.onConflict;
    return this;
  }
  update(values: Record<string, unknown>): this {
    this.state.method = 'PATCH';
    this.state.body = values;
    return this;
  }
  delete(): this {
    this.state.method = 'DELETE';
    return this;
  }
  /** Mark write op to return the affected row(s). */
  returning(): this {
    this.state.returnRepresentation = true;
    return this;
  }

  // ── Shape modifiers (re-type the resolved value) ──────────────────

  /**
   * Expect exactly one row — server returns 406 otherwise.
   * After this, the result data is T (not T[]).
   */
  single(): QueryBuilder<T, T> {
    this.state.acceptSingle = true;
    return this as unknown as QueryBuilder<T, T>;
  }
  /**
   * Expect zero or one row — never errors on shape.
   * After this, the result data is T | null.
   */
  maybeSingle(): QueryBuilder<T, T | null> {
    this.state.acceptMaybeSingle = true;
    this.state.filters.push('limit=1');
    return this as unknown as QueryBuilder<T, T | null>;
  }
  /** Return CSV text instead of JSON rows. */
  csv(): QueryBuilder<T, string> {
    this.state.acceptCsv = true;
    return this as unknown as QueryBuilder<T, string>;
  }
  /**
   * Include the total row count in the result. The resolved value
   * becomes `{ rows: T[]; count: number }` — count is the size of
   * the FULL result set ignoring limit/offset/range.
   * `mode='exact'` is accurate (slow on big tables);
   * `'planned'` uses the planner estimate;
   * `'estimated'` uses planner then exact-counts only if small.
   */
  count(mode: 'exact' | 'planned' | 'estimated' = 'exact'): QueryBuilder<T, CountedResult<T>> {
    this.state.countMode = mode;
    return this as unknown as QueryBuilder<T, CountedResult<T>>;
  }

  // ── Misc ──────────────────────────────────────────────────────────

  /** Add an arbitrary header to the request (e.g. `Prefer: missing=null`). */
  setHeader(name: string, value: string): this {
    this.state.extraHeaders = { ...(this.state.extraHeaders ?? {}), [name]: value };
    return this;
  }
  /** HEAD request — no body returned. Pair with `.count()` to fetch just a total. */
  head(): this {
    this.state.method = 'HEAD';
    return this;
  }

  // ── Thenable ──────────────────────────────────────────────────────

  then<TR1 = Result<R>, TR2 = never>(
    onFulfilled?: ((value: Result<R>) => TR1 | PromiseLike<TR1>) | null,
    onRejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): PromiseLike<TR1 | TR2> {
    return this.execute().then(onFulfilled, onRejected);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private appendFilter(col: string, op: string, val: unknown): this {
    this.state.filters.push(`${col}=${op}.${encodeURIComponent(String(val))}`);
    return this;
  }

  private formatArrayOrJson(val: unknown): string {
    if (Array.isArray(val)) return `{${val.map((v) => String(v)).join(',')}}`;
    if (typeof val === 'object' && val !== null) return JSON.stringify(val);
    return String(val);
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Authorization': `Bearer ${this.state.key}` };
    if (this.state.body !== undefined) h['Content-Type'] = 'application/json';

    if (this.state.acceptSingle) h['Accept'] = 'application/vnd.pgrst.object+json';
    else if (this.state.acceptCsv) h['Accept'] = 'text/csv';

    const prefer: string[] = [];
    if (this.state.returnRepresentation) prefer.push('return=representation');
    if (this.state.countMode) prefer.push(`count=${this.state.countMode}`);
    if (this.state.upsertResolution) prefer.push(`resolution=${this.state.upsertResolution}`);
    if (prefer.length) h['Prefer'] = prefer.join(',');

    if (this.state.rangeFrom !== undefined && this.state.rangeTo !== undefined) {
      h['Range'] = `${this.state.rangeFrom}-${this.state.rangeTo}`;
      h['Range-Unit'] = 'items';
    }

    if (this.state.schemaName) {
      const m = this.state.method ?? 'GET';
      if (m === 'GET' || m === 'HEAD') h['Accept-Profile'] = this.state.schemaName;
      else h['Content-Profile'] = this.state.schemaName;
    }

    if (this.state.extraHeaders) Object.assign(h, this.state.extraHeaders);
    return h;
  }

  private async execute(): Promise<Result<R>> {
    const method = this.state.method ?? 'GET';
    const filters = [...this.state.filters];
    if (this.state.onConflict) filters.push(`on_conflict=${encodeURIComponent(this.state.onConflict)}`);
    const qs = filters.length ? '?' + filters.join('&') : '';
    const url = urlJoin(this.state.base, `/postgres/${this.state.table}${qs}`);
    const headers = this.buildHeaders();
    const res = await this.state.fetchFn(url, {
      method,
      headers,
      body: this.state.body !== undefined ? JSON.stringify(this.state.body) : undefined,
    });

    // CSV: text payload.
    if (this.state.acceptCsv) {
      if (!res.ok) return (await asResult<unknown>(res)) as Result<R>;
      return { data: (await res.text()) as unknown as R, error: null };
    }

    // count: parse Content-Range "0-99/12345".
    if (this.state.countMode) {
      const contentRange = res.headers.get('Content-Range');
      const total = contentRange?.split('/')[1];
      const count = total && total !== '*' ? parseInt(total, 10) : 0;
      // HEAD: rows are empty, only the count matters.
      if (method === 'HEAD') {
        if (!res.ok) return (await asResult<unknown>(res)) as Result<R>;
        return { data: { rows: [], count } as unknown as R, error: null };
      }
      const inner = await asResult<T[]>(res);
      if (inner.error) return inner as unknown as Result<R>;
      return { data: { rows: inner.data, count } as unknown as R, error: null };
    }

    // maybeSingle: empty array → null, otherwise first element.
    if (this.state.acceptMaybeSingle) {
      if (!res.ok) return (await asResult<unknown>(res)) as Result<R>;
      const body = await parseBody(res);
      if (Array.isArray(body)) {
        return { data: ((body[0] as unknown) ?? null) as R, error: null };
      }
      return { data: (body ?? null) as R, error: null };
    }

    // single: PostgREST already returned the singleton — pass through.
    return await asResult<R>(res);
  }
}

// ───────────────────────────────────────────────────────────────────
// Top-level client
// ───────────────────────────────────────────────────────────────────

export class Postgrest {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  /** Start a query against a table or view. */
  from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>({
      base: this.url,
      key: this.key,
      table,
      fetchFn: this.fetchFn,
      filters: [],
    });
  }

  /**
   * Call a stored procedure (PostgREST RPC). Returns whatever the
   * function returns — set the generic to type it. Pass `count:'exact'`
   * if you want a total in the same envelope.
   */
  async rpc<T = unknown>(
    fnName: string,
    args: Record<string, unknown> = {},
    opts: { schema?: string; count?: 'exact' | 'planned' | 'estimated'; head?: boolean } = {},
  ): Promise<Result<T>> {
    const url = urlJoin(this.url, `/postgres/rpc/${fnName}`);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
    };
    const prefer: string[] = [];
    if (opts.count) prefer.push(`count=${opts.count}`);
    if (prefer.length) headers['Prefer'] = prefer.join(',');
    if (opts.schema) headers['Content-Profile'] = opts.schema;
    const res = await this.fetchFn(url, {
      method: opts.head ? 'HEAD' : 'POST',
      headers,
      body: opts.head ? undefined : JSON.stringify(args),
    });
    return await asResult<T>(res);
  }

  /** Return a new Postgrest authenticated as a specific end-user (RLS applies). */
  asUser(accessToken: string): Postgrest {
    return new Postgrest(this.url, accessToken, this.fetchFn);
  }
}

export function createPostgrest(opts: IchibaseConfig = {}): Postgrest {
  const cfg = resolveConfig(opts);
  return new Postgrest(cfg.url, cfg.key, cfg.fetchFn);
}
