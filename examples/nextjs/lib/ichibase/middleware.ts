// The session-refreshing middleware (the Supabase pattern). On every matched
// request it builds a server client bound to the request + response cookies,
// calls `getUser()` (which transparently refreshes an expired access token and
// writes the new session back onto the response cookies), and gates protected
// routes. Server Components can't write cookies, so this is what keeps tokens
// fresh while the user navigates.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@ichibase/client/ssr';

const PROTECTED = ['/account', '/notes'];

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

  // IMPORTANT: do not run code between createServerClient and getUser() — an
  // expired token is refreshed here, and the refreshed cookies must land on
  // `response`.
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
