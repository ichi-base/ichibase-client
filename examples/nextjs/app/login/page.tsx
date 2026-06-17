'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, verifyTwoFactorAction, type LoginState } from './actions';

const initial: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);
  const [twofa, verify, verifying] = useActionState(verifyTwoFactorAction, initial);

  // If login returned a 2-step challenge (or a 2FA verify failed), show the code form.
  const challenge = state.twofa ?? twofa.twofa;
  if (challenge) {
    return (
      <>
        <h1>Two-step verification</h1>
        <p>
          Enter the code emailed to <strong>{challenge.email}</strong>.
        </p>
        <form action={verify} className="card">
          <input type="hidden" name="email" value={challenge.email} />
          <label htmlFor="code">Code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
          {twofa.error && <p className="err">{twofa.error}</p>}
          <button disabled={verifying}>{verifying ? 'Verifying…' : 'Verify'}</button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>Sign in</h1>
      <form action={action} className="card">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {state.error && <p className="err">{state.error}</p>}
        <button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="muted">
        No account? <Link href="/signup">Create one</Link>.
      </p>
    </>
  );
}
