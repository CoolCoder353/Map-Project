import type { ReactNode } from 'react';
import { LogoMark } from '../components/LogoMark';
import { useAppConfig } from '../lib/config';

export function AuthLayout({ title, intro, children, footer }: { title: string; intro?: string; children: ReactNode; footer?: ReactNode }) {
  const { copy } = useAppConfig();
  return (
    <main className="auth">
      <div className="auth-card">
        <LogoMark className="brand-mark brand-mark-lg" />
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="auth-intro">{intro}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
      <p className="auth-tagline">{copy.tagline}</p>
    </main>
  );
}
