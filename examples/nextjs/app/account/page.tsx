import Link from 'next/link';
import { createClient } from '@/lib/ichibase/server';

// Protected Server Component. The middleware already redirects anonymous users
// here-away, but we guard again and (the point of this page) read data on the
// SERVER with the user's token attached — so RLS applies as this user.
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

  // Server-side, RLS-scoped read. Requires a `notes` table with row-level
  // security (see the README). If you haven't created it, this just shows the
  // error — auth still works.
  const { data, error } = await ichi.from('notes').select('*');
  const count = Array.isArray(data) ? data.length : 0;

  return (
    <>
      <h1>Account</h1>
      <div className="card">
        <h2>User (from the server)</h2>
        <p>
          Email: <strong>{user.email}</strong>
          <br />
          User ID: <code>{user.id}</code>
          <br />
          Email verified: <strong>{user.verified_at ? 'yes' : 'no'}</strong>
        </p>
      </div>

      <div className="card">
        <h2>Your notes (server-rendered, RLS-scoped)</h2>
        {error ? (
          <p className="err">
            {error.detail ?? error.code} — create a <code>notes</code> table with RLS (see README).
          </p>
        ) : (
          <p>
            You have <strong>{count}</strong> note{count === 1 ? '' : 's'}. Add some on the{' '}
            <Link href="/notes">Notes</Link> page (client-side) and refresh — this server read sees
            only <em>your</em> rows.
          </p>
        )}
      </div>
    </>
  );
}
