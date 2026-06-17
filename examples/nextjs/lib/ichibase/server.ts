// Server client — use this in Server Components, Server Actions, and Route
// Handlers. It reads the session from the request cookies and (where allowed)
// writes refreshed cookies back. `cookies()` is awaited once so the adapter is
// synchronous and the client hydrates its session immediately.
import { cookies } from 'next/headers';
import { createServerClient } from '@ichibase/client/ssr';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_ICHIBASE_URL!,
    process.env.NEXT_PUBLIC_ICHIBASE_ANON_KEY!,
    {
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `set` throws in a Server Component (cookies are read-only there).
            // That's fine: the middleware refreshes + writes the session, so a
            // Server Component never needs to.
          }
        },
      },
    },
  );
}
