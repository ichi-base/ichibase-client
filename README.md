# @ichibase/client

The official **client-side** SDK for [ichibase](https://ichibase.com) — Postgres,
MongoDB, Auth, and Realtime from a single client. Built for the browser,
React Native, Deno, Node 22+, and Bun. **Anon key only** — depends solely on
global `fetch` + `WebSocket`, zero runtime dependencies.

> Building a server, edge function, or admin tool with the **service** key? Use
> the JSR SDKs (`@ichibase/postgrest`, `@ichibase/auth`, …) instead. This package
> refuses `ich_admin_` keys by design.

## Install

```bash
npm install @ichibase/client
```

## Quick start

```ts
import { createClient } from '@ichibase/client';

const ichi = createClient(
  'https://<project>.ichibase.net',
  'ich_pub_…', // your project's publishable (anon) key — safe to ship
);
```

### Database (PostgREST)

```ts
// Read (role = anon until a user logs in)
const { data, error } = await ichi.from('posts').select('*').eq('published', true);

// Insert / update / delete
await ichi.from('posts').insert({ title: 'Hello' });
await ichi.from('posts').update({ title: 'Edited' }).eq('id', 1);
await ichi.from('posts').delete().eq('id', 1);

// RPC
const { data: total } = await ichi.rpc('count_posts', { author: 'me' });
```

### Auth + per-user access

```ts
await ichi.auth.signup({ email, password });
await ichi.auth.login({ email, password });

// After login, data calls automatically use the user's access token, so your
// RLS policies and realtime rules see `auth.uid()` etc.
await ichi.from('posts').insert({ title: 'mine' });

const user = await ichi.auth.getUser();
await ichi.auth.logout();

// React to session changes (e.g. update UI)
ichi.onAuthStateChange((event, session) => {
  console.log(event, session?.user?.email);
});
```

#### Persisting the session

The session lives in memory by default. Pass a storage adapter to keep users
logged in across reloads:

```ts
// Browser
const ichi = createClient(url, anonKey, { storage: window.localStorage });

// React Native (expo-secure-store / AsyncStorage). Async adapters need an
// explicit hydrate at startup:
const ichi = createClient(url, anonKey, { storage: SecureStoreAdapter });
await ichi.auth.loadSession();
```

### Storage

Storage is **not** on the client. Read/upload tokens are minted server-side by
the project owner (an Edge Function using the service key) and handed to your
app. Public files are read directly from
`https://cdn.ichibase.net/<project>/public/<path>`. See the
[Storage docs](https://ichibase.com/docs/storage).

### Mongo

```ts
await ichi.mongo.collection('orders').insertOne({ total: 42 });
const docs = await ichi.mongo.collection('orders').find({ total: { $gt: 10 } });
```

### Realtime

```ts
// Postgres row changes
const sub = ichi.realtime.subscribe(
  { kind: 'postgres', table: 'messages', events: ['INSERT'] },
  (msg) => console.log(msg.event, msg.record),
);

// Broadcast + presence
const room = ichi.realtime.subscribe(
  { kind: 'broadcast', channel: 'room:42', presence: true },
  (msg) => console.log(msg),
);
room.send('chat', { text: 'hi' });
room.track({ typing: true });

sub.unsubscribe();
```

## Web vs. native: CORS

Native apps (React Native, Node, servers) are unaffected by CORS. **Browser**
apps must be allow-listed: in your ichibase dashboard → project → Settings →
CORS, add your origin (e.g. `https://yourapp.com`, `http://localhost:5173`).
Until you do, browsers refuse cross-origin calls (default-deny).

## Security model

The anon key is **publishable** — it's meant to be shipped in clients. Access is
gated by your **Row-Level Security policies** (Postgres) and **collection
policies** (Mongo), not by hiding the key. A table with RLS disabled (or enabled
with no matching policy) is open to anyone holding the anon key — so enable RLS
on everything you expose. Never put an `ich_admin_` (service) key in a client.

## License

MIT
