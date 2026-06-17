// Browser client — use this in Client Components ("use client").
// Reads/writes the session cookie via the browser, so it shares the session
// with the server. Singleton, so every component gets the same instance.
import { createBrowserClient } from '@ichibase/client/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_ICHIBASE_URL!,
    process.env.NEXT_PUBLIC_ICHIBASE_ANON_KEY!,
  );
}
