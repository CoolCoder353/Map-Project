import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAppConfig } from '../lib/config';
import { AuthLayout } from './AuthLayout';

export function SignInPage() {
  const { login } = useAuth();
  const { config, copy } = useAppConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password });
      const to = (location.state as { from?: string } | null)?.from ?? '/directions';
      navigate(to, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={copy.signInTitle(config.appName)}
      footer={
        <>
          New here? <Link to="/register">Create an account with an invite code</Link>
          <br />
          <Link to="/privacy">Privacy policy</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email || !password}>
          {busy && <span className="spinner" aria-hidden />} Sign in
        </button>
        <p className="field-hint">Forgot your password? Ask an admin for a reset link.</p>
      </form>
    </AuthLayout>
  );
}
