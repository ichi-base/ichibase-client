'use server';

import { redirect } from 'next/navigation';
import { isTwoFactorChallenge } from '@ichibase/client';
import { createClient } from '@/lib/ichibase/server';

export type LoginState = {
  error?: string;
  // Set when the project requires a 2-step code: the form switches to a code input.
  twofa?: { email: string; methods: ('otp' | 'magic')[] };
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Email and password are required.' };

  const ichi = await createClient();
  const { data, error } = await ichi.auth.login({ email, password });
  if (error) return { error: error.detail ?? error.code };

  // 2-step verification: a code/link was emailed; finish via verifyTwoFactor.
  if (data && isTwoFactorChallenge(data)) {
    return { twofa: { email, methods: data.methods } };
  }

  // Success — the session cookie was written by login(). Go to the protected page.
  redirect('/account');
}

export async function verifyTwoFactorAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const ichi = await createClient();
  const { error } = await ichi.auth.verifyTwoFactor({ email, code });
  if (error) return { error: error.detail ?? error.code, twofa: { email, methods: ['otp'] } };
  redirect('/account');
}
