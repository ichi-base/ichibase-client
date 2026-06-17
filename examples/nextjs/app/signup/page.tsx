'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signupAction, type SignupState } from './actions';

const initial: SignupState = {};

export default function SignupPage() {
  const [state, action, pending] = useActionState(signupAction, initial);

  if (state.ok) {
    return (
      <>
        <h1>Account created</h1>
        <div className="card">
          <p className="ok">
            If your project requires email verification, check your inbox first. Then{' '}
            <Link href="/login">sign in</Link>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Create account</h1>
      <form action={action} className="card">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        {state.error && <p className="err">{state.error}</p>}
        <button disabled={pending}>{pending ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="muted">
        Already have an account? <Link href="/login">Sign in</Link>.
      </p>
    </>
  );
}
