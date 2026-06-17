// The session-refreshing middleware (the Supabase pattern). On every matched
// request it builds a server client bound to the request + response cookies,
// calls `getUser()` (which transparently refreshes an expired access token and
// writes the new session back onto the response cookies), and gates protected
// routes. Server Components can't write cookies, so this is what keeps tokens
// fresh while the user navigates.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@ichibase/client/ssr';

const PROTECTED = ['/account', '/mongo', '/postgres', '/realtime'];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const ichi = createServerClient(
    process.env.NEXT_PUBLIC_ICHIBASE_URL!,
    process.env.NEXT_PUBLIC_ICHIBASE_ANON_KEY!,
    {
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mirror onto the request (so anything downstream in this pass sees
          // the fresh cookie) and onto the response (so the browser stores it).
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Proactively refresh the access token when it's expired or about to expire.
  // (Auth calls like getUser() use the raw fetch and do NOT auto-refresh — only
  // data calls do — so the middleware must refresh explicitly.) The refreshed
  // session is written back through setAll above, so the fresh cookie lands on
  // `response` and the browser + Server Components see it.
  const session = ichi.getSession();
  if (session?.refresh_token) {
    const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
    if (expiresInMs < 60_000) {
      await ichi.auth.refresh();
    }
  }

  // Validate the (now-fresh) token + get the user. Null → not signed in.
  const user = await ichi.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return response;
}
