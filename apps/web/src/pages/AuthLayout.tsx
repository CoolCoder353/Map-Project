import type { ReactNode } from 'react';
import { useAppConfig } from '../lib/config';

export function AuthLayout({ title, intro, children, footer }: { title: string; intro?: string; children: ReactNode; footer?: ReactNode }) {
  const { config, copy } = useAppConfig();
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <svg viewBox="0 0 32 32" aria-hidden className="brand-mark brand-mark-lg">
            <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--accent)" />
            <path d="M16 9.5 22 13v7l-6 3.5-6-3.5v-7z" fill="var(--surface)" />
            <circle cx="16" cy="16.5" r="2.6" fill="var(--explore)" />
          </svg>
          <span className="brand-name">{config.appName}</span>
        </div>
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="auth-intro">{intro}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
      <p className="auth-tagline">{copy.tagline}</p>
    </main>
  );
}
