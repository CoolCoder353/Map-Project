import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="Reset link missing" intro="Open the full link an admin sent you, or ask them for a new one.">
        <Link to="/sign-in" className="btn btn-secondary btn-block">Back to sign in</Link>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout title="Password changed" intro="You’ve been signed out of other devices. Sign in with your new password.">
        <Link to="/sign-in" className="btn btn-primary btn-block">Sign in</Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password">
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
            setDone(true);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="new-password">New password</label>
          <input id="new-password" className="input" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          <span className="field-hint">At least 10 characters.</span>
        </div>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || password.length < 10}>
          {busy && <span className="spinner" aria-hidden />} Save password
        </button>
      </form>
    </AuthLayout>
  );
}
