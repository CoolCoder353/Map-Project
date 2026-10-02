import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../components/LogoMark';
import { useAppConfig } from '../lib/config';

/** Where privacy and deletion questions go. There is no contact field in the admin settings yet. */
export const PRIVACY_CONTACT = 'googledev@gmail.com';

/** A plain reading page that needs no sign-in: the privacy policy and the deletion instructions. */
export function DocPage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  const { config } = useAppConfig();
  return (
    <main className="doc">
      <article className="doc-card">
        <header className="doc-head">
          <LogoMark className="brand-mark" />
          <span className="doc-brand">{config.appName}</span>
        </header>
        <h1 className="auth-title">{title}</h1>
        {updated && <p className="field-hint">Last updated {updated}</p>}
        {children}
        <footer className="auth-footer">
          <Link to="/privacy">Privacy policy</Link> · <Link to="/delete-account">Delete your account</Link> · <Link to="/sign-in">Sign in</Link>
        </footer>
      </article>
    </main>
  );
}
