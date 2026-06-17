# ichibase + Next.js (App Router) — SSR auth example

Supabase-style cookie auth with [`@ichibase/client`](https://www.npmjs.com/package/@ichibase/client):

- a **browser client** (`createBrowserClient`) for Client Components,
- a **server client** (`createServerClient`) for Server Components / Server Actions / Route Handlers,
- **middleware** that refreshes the access token on every navigation,

with the session stored in a **cookie** so the server and the browser share it.

## How it works

| Piece | File | Role |
|---|---|---|
| Browser client | `lib/ichibase/client.ts` | `createBrowserClient(...)` — reads/writes the session cookie from the browser; self-refreshes on a 401. Use in `"use client"` components. |
| Server client | `lib/ichibase/server.ts` | `createServerClient(url, key, { cookies })` built from `await cookies()`. Use in Server Components, Server Actions, Route Handlers. |
| Middleware | `lib/ichibase/middleware.ts` + `middleware.ts` | On each request, calls `auth.getUser()` — an expired access token is refreshed and the new cookie is written to the response. Server Components can't set cookies, so this keeps tokens fresh. Also guards `/account` and `/notes`. |

The session lives in one cookie (`ichibase.session`, base64url-encoded). It is **not** `httpOnly`
— the browser client must read it. That's the same model Supabase uses; the exposure is the same
as `localStorage`. (A hardened, server-only `httpOnly` variant is possible but isn't this example.)

## Run it

This example consumes the **local** `@ichibase/client` build via a `file:` dependency
(`"@ichibase/client": "file:../.."`) — no npm install of the published package.

```sh
# 1. Build the SDK first (emits dist/ incl. dist/ssr.*)
cd /Volumes/LaCie/code/ichibase-client
npm install
npm run build

# 2. Install + run the example (links to the local build above)
cd examples/nextjs
npm install
cp .env.local.example .env.local   # then fill in your project URL + anon key
npm run dev                        # http://localhost:3000
```

`.env.local`:

```
NEXT_PUBLIC_ICHIBASE_URL=https://<your-project>.ichibase.net
NEXT_PUBLIC_ICHIBASE_ANON_KEY=ich_pub_...
```

> Re-run `npm run build` in the SDK repo whenever you change the SDK source.

### Allow your origin (CORS) — required for client-side calls

ichibase's data plane is **default-deny CORS** per project. **Server-side** calls (Server
Components, Server Actions, middleware — including login/signup/logout here) are server-to-server
and unaffected. But **client-side** calls from the browser (the `/notes` page, realtime) will be
blocked until you add your app's origin to the project's **Allowed origins** (CORS settings) in the
dashboard — exactly like adding your site URL in Supabase:

- dev: `http://localhost:3000`
- prod: your deployed origin (e.g. `https://app.example.com`)

Without this you'll see `Failed to fetch` in the browser for client-side data/realtime, while
auth and the server-rendered pages still work.

## Pages

Each data API has its own **Client Component** page (uses the browser client), plus a protected
server page:

| Page | What it shows |
|---|---|
| `/account` | Protected **Server Component** — reads your user server-side from the session cookie. |
| `/mongo` | Mongo collection CRUD via `ichi.mongo.collection(name)`. Default collection `orders`. |
| `/postgres` | Postgres table CRUD via `ichi.from(table)` (PostgREST). Default table `notes`. |
| `/realtime` | Subscribe to a Mongo collection or Postgres table; live change events over a WebSocket. |

Auth (login/signup/logout) works with **no tables** — it runs through Server Actions. The data
pages need the matching backend on your project (a Mongo collection / a Postgres table) and your
app origin in the CORS allowlist (above).

### Optional: a Postgres `notes` table for `/postgres`

```sql
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "own notes" on public.notes
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

Enable **realtime** on the table/collection in the dashboard so `/realtime` shows events.

## What to try

1. **Sign up** (`/signup`) → **sign in** (`/login`). If the project enforces 2-step verification,
   the login form switches to a code step automatically.
2. **`/account`** — a protected Server Component that reads your user **on the server**.
3. **`/mongo`** / **`/postgres`** — insert + list + delete from the **browser** client (scoped to
   you by your policies / RLS).
4. **`/realtime`** — subscribe, then insert on `/mongo` and watch the event arrive.
5. Leave the tab open until the access token expires, then navigate — the **middleware refreshes**
   it transparently (you stay signed in; the cookie is rewritten).
6. **Sign out** (top-right) clears the cookie.
