import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { createClient } from '@/lib/ichibase/server';
import { logout } from '@/app/account/actions';

export const metadata: Metadata = {
  title: 'ichibase + Next.js',
  description: 'Supabase-style cookie auth with @ichibase/client',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-rendered nav: reads the session from the cookie on the server.
  const ichi = await createClient();
  const user = await ichi.auth.getUser();

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            ichibase
          </Link>
          <Link href="/mongo">Mongo</Link>
          <Link href="/postgres">Postgres</Link>
          <Link href="/realtime">Realtime</Link>
          <Link href="/account">Account</Link>
          <span className="spacer" />
          {user ? (
            <>
              <span className="muted">{user.email}</span>
              <form action={logout}>
                <button className="secondary" style={{ marginTop: 0 }}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </nav>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
