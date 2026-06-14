// Realtime client — one WebSocket per IchibaseClient, multiplexing many
// subscriptions. Speaks the ichibase realtime wire protocol (one JSON object
// per text frame). Works anywhere `WebSocket` is global (browser, React
// Native, Deno, Node 22+, Bun).
//
// Wire protocol (client → server): subscribe | unsubscribe | broadcast |
// presence | token | ping. (server → client): subscribed | change | broadcast
// | presence_state | presence_diff | error | pong | closing | token_refreshed.

export type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE';
export type MongoChangeEvent = 'insert' | 'update' | 'delete';

/** A row/document change frame delivered to a postgres/mongo subscriber. */
export interface ChangeMessage {
  type: 'change';
  event: ChangeEvent | MongoChangeEvent;
  table?: string;
  collection?: string;
  /** The new row/document (absent on DELETE for some engines). */
  record?: Record<string, unknown>;
  /** The previous row, when the engine captures it (UPDATE/DELETE). */
  old?: Record<string, unknown>;
}

/** A broadcast message on a channel. */
export interface BroadcastMessage {
  type: 'broadcast';
  channel: string;
  event?: string;
  payload: unknown;
  /** user id of the sender (empty for anonymous). */
  from?: string;
}

/** Presence snapshot / diff. */
export interface PresenceMessage {
  type: 'presence_state' | 'presence_diff';
  channel?: string;
  presences?: Record<string, { uid: string; state?: unknown }>;
  joins?: Record<string, { uid: string; state?: unknown }>;
  leaves?: Record<string, { uid: string; state?: unknown }>;
}

export type RealtimeMessage = ChangeMessage | BroadcastMessage | PresenceMessage;

export interface PostgresSubscribeOptions {
  kind: 'postgres';
  /** `public.orders` or just `orders` (defaults to the public schema). */
  table: string;
  events?: ChangeEvent[];
  /** Optional client-side narrowing (rule grammar). */
  filter?: unknown;
}
export interface MongoSubscribeOptions {
  kind: 'mongo';
  collection: string;
  events?: MongoChangeEvent[];
  filter?: unknown;
}
export interface BroadcastSubscribeOptions {
  kind: 'broadcast';
  channel: string;
  /** Also track presence on this channel. */
  presence?: boolean;
  /** Initial presence state to publish on join. */
  state?: Record<string, unknown>;
}
export type SubscribeOptions =
  | PostgresSubscribeOptions
  | MongoSubscribeOptions
  | BroadcastSubscribeOptions;

/** Handle to one live subscription. */
export interface Subscription {
  /** Stop this subscription. */
  unsubscribe(): void;
  /** Publish to the channel (broadcast subscriptions only). */
  send(event: string, payload: unknown): void;
  /** Update this connection's presence state (broadcast + presence only). */
  track(state: Record<string, unknown>): void;
}

interface InternalSub {
  ref: string;
  opts: SubscribeOptions;
  handler: (msg: RealtimeMessage) => void;
}

export interface RealtimeOptions {
  /** Base project URL, e.g. https://abc.ichibase.net. */
  url: string;
  /** Returns the current bearer (user access token, or the anon key). */
  getToken: () => string | undefined;
  /** Override the WebSocket constructor (testing / non-global envs). */
  WebSocketImpl?: typeof WebSocket;
}

const HEARTBEAT_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export class RealtimeClient {
  private url: string;
  private getToken: () => string | undefined;
  private WS: typeof WebSocket;
  private ws: WebSocket | null = null;
  private subs = new Map<string, InternalSub>();
  private refSeq = 0;
  private connecting = false;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private outbox: string[] = [];

  constructor(opts: RealtimeOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.getToken = opts.getToken;
    const impl = opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!impl) {
      throw new Error('ichibase realtime: no global WebSocket — pass opts.WebSocketImpl');
    }
    this.WS = impl;
  }

  /** Subscribe to postgres/mongo changes or a broadcast channel. */
  subscribe(opts: SubscribeOptions, handler: (msg: RealtimeMessage) => void): Subscription {
    const ref = `s${++this.refSeq}`;
    this.subs.set(ref, { ref, opts, handler });
    this.ensureConnected();
    if (this.isOpen()) this.sendSubscribe(ref);

    return {
      unsubscribe: () => {
        this.subs.delete(ref);
        if (this.isOpen()) this.send({ type: 'unsubscribe', ref });
        if (this.subs.size === 0) this.disconnect();
      },
      send: (event, payload) => {
        if (opts.kind !== 'broadcast') throw new Error('send() is broadcast-only');
        this.send({ type: 'broadcast', channel: opts.channel, event, payload });
      },
      track: (state) => {
        if (opts.kind !== 'broadcast') throw new Error('track() is broadcast-only');
        this.send({ type: 'presence', channel: opts.channel, state });
      },
    };
  }

  /** Close the socket and drop all subscriptions. */
  disconnect(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  // ── internals ──────────────────────────────────────────────────────
  private isOpen(): boolean {
    return this.ws?.readyState === this.WS.OPEN;
  }

  private ensureConnected(): void {
    if (this.ws || this.connecting) return;
    this.closedByUser = false;
    this.connecting = true;
    const token = this.getToken();
    const wsUrl =
      this.url.replace(/^http/, 'ws') + '/realtime' + (token ? `?token=${encodeURIComponent(token)}` : '');
    const ws = new this.WS(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempts = 0;
      // (Re)subscribe everything and flush anything queued while offline.
      for (const ref of this.subs.keys()) this.sendSubscribe(ref);
      for (const raw of this.outbox.splice(0)) ws.send(raw);
      this.startHeartbeat();
    };
    ws.onmessage = (ev: MessageEvent) => this.onFrame(ev.data);
    ws.onclose = () => {
      this.connecting = false;
      this.stopHeartbeat();
      this.ws = null;
      if (!this.closedByUser && this.subs.size > 0) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows; reconnect handled there.
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    setTimeout(() => {
      if (!this.closedByUser && this.subs.size > 0) this.ensureConnected();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), HEARTBEAT_MS);
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private sendSubscribe(ref: string): void {
    const s = this.subs.get(ref);
    if (!s) return;
    const o = s.opts;
    const msg: Record<string, unknown> = { type: 'subscribe', ref, kind: o.kind };
    if (o.kind === 'postgres') {
      msg.table = o.table;
      if (o.events) msg.events = o.events;
      if (o.filter !== undefined) msg.filter = o.filter;
    } else if (o.kind === 'mongo') {
      msg.collection = o.collection;
      if (o.events) msg.events = o.events;
      if (o.filter !== undefined) msg.filter = o.filter;
    } else {
      msg.channel = o.channel;
      if (o.presence) msg.presence = true;
      if (o.state) msg.state = o.state;
    }
    this.send(msg);
  }

  private send(msg: Record<string, unknown>): void {
    const raw = JSON.stringify(msg);
    if (this.isOpen()) this.ws!.send(raw);
    else this.outbox.push(raw);
  }

  private onFrame(data: unknown): void {
    if (typeof data !== 'string') return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = m.type as string;
    if (type === 'pong' || type === 'subscribed' || type === 'unsubscribed' || type === 'token_refreshed') {
      return;
    }
    // Route data frames to matching subscriptions.
    if (type === 'change') {
      for (const s of this.subs.values()) {
        if (
          (s.opts.kind === 'postgres' && m.table === qualify(s.opts.table)) ||
          (s.opts.kind === 'mongo' && m.collection === s.opts.collection)
        ) {
          s.handler(m as unknown as ChangeMessage);
        }
      }
    } else if (type === 'broadcast') {
      for (const s of this.subs.values()) {
        if (s.opts.kind === 'broadcast' && m.channel === s.opts.channel) {
          s.handler(m as unknown as BroadcastMessage);
        }
      }
    } else if (type === 'presence_state' || type === 'presence_diff') {
      for (const s of this.subs.values()) {
        if (s.opts.kind === 'broadcast' && (m.channel === s.opts.channel || m.channel === undefined)) {
          s.handler(m as unknown as PresenceMessage);
        }
      }
    }
  }
}

function qualify(table: string): string {
  return table.includes('.') ? table : `public.${table}`;
}
