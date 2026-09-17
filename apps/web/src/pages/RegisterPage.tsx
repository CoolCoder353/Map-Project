import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAppConfig } from '../lib/config';
import { AuthLayout } from './AuthLayout';

export function RegisterPage() {
  const { register } = useAuth();
  const { config, copy } = useAppConfig();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState(params.get('code') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (password.length < 10) errs.password = 'Use at least 10 characters.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await register({ inviteCode, email, password });
      navigate('/directions', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const map: Record<string, string> = {};
        for (const d of err.details as Array<{ path: string; message: string }>) map[d.path] = d.message;
        setFieldErrors(map);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={`Join ${config.appName}`}
      intro={copy.registerIntro}
      footer={
        <>
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="code">Invite code</label>
          <input id="code" className="input num" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} aria-invalid={!!fieldErrors.inviteCode} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="reg-email">Email</label>
          <input id="reg-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldErrors.email} required />
          {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="reg-password">Password</label>
          <input id="reg-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldErrors.password} aria-describedby="pw-hint" required />
          <span className="field-hint" id="pw-hint">At least 10 characters.</span>
          {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}
        </div>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !inviteCode || !email || !password}>
          {busy && <span className="spinner" aria-hidden />} Create account
        </button>
      </form>
    </AuthLayout>
  );
}
