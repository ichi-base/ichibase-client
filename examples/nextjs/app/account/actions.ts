'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/ichibase/server';

export async function logout() {
  const ichi = await createClient();
  await ichi.auth.logout(); // revokes the refresh token + clears the session cookie
  redirect('/login');
}
