import Link from 'next/link';
import { createClient } from '@/lib/ichibase/server';

// Protected Server Component. The middleware redirects anonymous users away and
// keeps the token fresh; here we read the user's identity on the SERVER from the
// session cookie. The data demos live on their own (client-side) pages.
export default async function AccountPage() {
  const ichi = await createClient();
  const user = await ichi.auth.getUser();

  if (!user) {
    return (
      <p>
        Not signed in. <Link href="/login">Sign in</Link>.
      </p>
    );
  }

  return (
    <>
      <h1>Account</h1>
      <div className="card">
        <h2>User (read on the server)</h2>
        <p>
          Email: <strong>{user.email}</strong>
          <br />
          User ID: <code>{user.id}</code>
          <br />
          Email verified: <strong>{user.verified_at ? 'yes' : 'no'}</strong>
        </p>
      </div>
      <div className="card">
        <h2>Try the data APIs (client-side)</h2>
        <ul className="list">
          <li>
            <Link href="/mongo">Mongo</Link> — collection CRUD via the browser client.
          </li>
          <li>
            <Link href="/postgres">Postgres</Link> — table CRUD via PostgREST.
          </li>
          <li>
            <Link href="/realtime">Realtime</Link> — live change events over a WebSocket.
          </li>
        </ul>
      </div>
    </>
  );
}
