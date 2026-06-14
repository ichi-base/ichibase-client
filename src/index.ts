// @ichibase/client — the official client-side SDK for ichibase.
//
//   import { createClient } from '@ichibase/client';
//   const ichi = createClient('https://<project>.ichibase.net', 'ich_pub_…');
//
// Anon key only. Works in browsers, React Native, Deno, Node 22+, and Bun —
// it depends solely on global fetch + WebSocket.

export { createClient, IchibaseClient } from './client.js';
export type { ClientOptions, Session, AuthEvent } from './client.js';

// Session persistence adapters.
export { MemoryStorage } from './storage-adapter.js';
export type { SessionStorage } from './storage-adapter.js';

// Realtime.
export { RealtimeClient } from './realtime.js';
export type {
  RealtimeMessage,
  ChangeMessage,
  BroadcastMessage,
  PresenceMessage,
  Subscription,
  SubscribeOptions,
  PostgresSubscribeOptions,
  MongoSubscribeOptions,
  BroadcastSubscribeOptions,
  ChangeEvent,
  MongoChangeEvent,
} from './realtime.js';

// Per-domain classes + types (advanced / direct use).
export { Postgrest, QueryBuilder } from './postgrest.js';
export type { FilterOp, CountedResult } from './postgrest.js';
export { Auth } from './auth.js';
export type {
  SignupResult,
  LoginResult,
  RefreshResult,
  UserProfile,
  UpdatedUser,
  SessionInfo,
} from './auth.js';
export { Mongo, MongoCollection } from './mongo.js';
export { Functions } from './functions.js';
export type { InvokeOptions } from './functions.js';

// Shared result/error/config types.
export type { Result, IchibaseError, IchibaseConfig } from './core.js';
