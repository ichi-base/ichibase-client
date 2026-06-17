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

#### Passwordless sign-in (OTP & magic link)

If the project enables it (custom SMTP required), users can sign in without a
password — a one-time code, a magic link, or both in one email. This is
additive: email + password keeps working too.

```ts
// 1. Send the sign-in email (always succeeds, even for unknown emails)
await ichi.auth.signInWithOtp({ email });

// 2a. User typed the 6-digit code → signs them in (session is set):
await ichi.auth.verifyOtp({ email, code });

// 2b. …or your magic-link landing page exchanges the token from the URL:
const token = new URL(location.href).searchParams.get('token');
await ichi.auth.verifyMagicLink(token!);
```

#### 2-step verification (login)

If the project requires it (custom SMTP), `login` returns a **2FA challenge**
instead of a session — a code and/or magic link is emailed. Finish with
`verifyTwoFactor` (the code) or `verifyTwoFactorMagic` (the token from the link).

```ts
const { data } = await ichi.auth.login({ email, password });
if (data && isTwoFactorChallenge(data)) {
  // a factor was emailed (data.methods) — prompt, then:
  await ichi.auth.verifyTwoFactor({ email, code });
  // …or from your magic-link landing page:
  // await ichi.auth.verifyTwoFactorMagic(token);
} else {
  // no 2FA — `data` is the session
}
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

#### Server-side rendering (Next.js / SSR)

For SSR the session must live in a **cookie** (a server can't read
`localStorage`). Import from `@ichibase/client/ssr` — two factories modeled on
Supabase's `@supabase/ssr`, sharing one cookie (`ichibase.session`) so a Server
Component and a Client Component see the same session at once (pick **per
context, not per app**):

- **`createBrowserClient(url, anonKey)`** — Client Components (`"use client"`).
  A singleton that reads/writes the cookie via `document.cookie` and refreshes an
  expired token itself.
- **`createServerClient(url, anonKey, { cookies })`** — Server Components, Server
  Actions, Route Handlers, middleware. Created per request; you hand it your
  framework's cookie store.

```ts
// lib/ichibase/client.ts — Client Components
import { createBrowserClient } from '@ichibase/client/ssr';
export const createClient = () => createBrowserClient(URL, ANON_KEY);

// lib/ichibase/server.ts — Server Components / Actions / Route Handlers
import { cookies } from 'next/headers';
import { createServerClient } from '@ichibase/client/ssr';

export async function createClient() {
  const store = await cookies();
  return createServerClient(URL, ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) =>
        list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
```

Server Components can't write cookies, so run **middleware** to keep the token
fresh and gate protected routes — it calls `ichi.auth.refresh()` when the token
is near expiry, then `ichi.auth.getUser()`. A complete runnable app is in
[`examples/nextjs`](./examples/nextjs); full walkthrough in the
[Auth docs → Client-side vs server-side (SSR)](https://ichibase.com/docs/auth).

> The session cookie is **not httpOnly** (the browser client must read it to
> refresh itself). Your short-lived access token plus your RLS / Mongo / realtime
> rules are the real gate.

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
