'use server';

import { createClient } from '@/lib/ichibase/server';

export type SignupState = { error?: string; ok?: boolean };

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are required.' };

  const ichi = await createClient();
  const { error } = await ichi.auth.signup({ email, password });
  if (error) return { error: error.detail ?? error.code };
  // signup does NOT create a session — the user signs in next (and may need to
  // verify their email first, if the project requires it).
  return { ok: true };
}
