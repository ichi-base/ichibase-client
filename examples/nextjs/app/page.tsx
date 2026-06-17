import Link from 'next/link';
import { createClient } from '@/lib/ichibase/server';

export default async function Home() {
  const ichi = await createClient();
  const user = await ichi.auth.getUser();

  return (
    <>
      <h1>ichibase + Next.js (App Router)</h1>
      <p>
        Supabase-style cookie auth with <code>@ichibase/client/ssr</code>: a browser client, a
        server client, and middleware that refreshes the JWT.
      </p>

      <div className="card">
        <h2>Session (read on the server)</h2>
        {user ? (
          <p className="ok">
            Signed in as <strong>{user.email}</strong> (id <code>{user.id}</code>).
          </p>
        ) : (
          <p>
            Not signed in. <Link href="/login">Sign in</Link> or{' '}
            <Link href="/signup">create an account</Link>.
          </p>
        )}
      </div>

      <div className="card">
        <h2>What to try</h2>
        <ul className="list">
          <li>
            <Link href="/account">/account</Link> — a protected <strong>Server Component</strong>{' '}
            that reads the user + their rows server-side (RLS applies as the user).
          </li>
          <li>
            <Link href="/notes">/notes</Link> — a <strong>Client Component</strong> reading/writing
            data + a realtime subscription, using the browser client.
          </li>
          <li>
            Let the access token expire while you browse — the middleware refreshes it
            transparently (no logout).
          </li>
        </ul>
      </div>
    </>
  );
}
