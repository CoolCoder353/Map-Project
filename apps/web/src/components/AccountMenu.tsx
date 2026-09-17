import { LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../lib/auth';

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  if (!user) return null;
  const initial = user.email[0]?.toUpperCase() ?? '?';
  return (
    <div className="account" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${user.email}`} onClick={() => setOpen((o) => !o)}>
        {initial}
      </button>
      {open && (
        <div className="menu" role="menu" style={{ right: 0, top: 48 }}>
          <p className="menu-email">{user.email}</p>
          <div className="menu-sep" />
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}>
            <Settings aria-hidden /> Settings
          </Link>
          {user.role !== 'user' && (
            <Link role="menuitem" to="/admin" onClick={() => setOpen(false)}>
              <LayoutDashboard aria-hidden /> Admin dashboard
            </Link>
          )}
          <div className="menu-sep" />
          <button role="menuitem" type="button" onClick={() => void logout()}>
            <LogOut aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
