import { LayoutDashboard, LogOut, MessageSquarePlus, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../lib/auth';
import { useAppConfig } from '../lib/config';
import { captureScreen } from '../lib/screenshot';
import { useMapApi } from '../map/MapProvider';
import { FeedbackDialog } from './FeedbackDialog';

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { config } = useAppConfig();
  const map = useMapApi();
  const [feedback, setFeedback] = useState<{ open: boolean; shot: Blob | null }>({ open: false, shot: null });

  const startFeedback = async () => {
    setOpen(false);
    // Let the menu close first so the capture shows the screen, not the menu.
    await nextPaint();
    const shot = await captureScreen(map).catch(() => null);
    setFeedback({ open: true, shot });
  };
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
          {config.feedbackEnabled && (
            <button role="menuitem" type="button" onClick={() => void startFeedback()}>
              <MessageSquarePlus aria-hidden /> Send feedback
            </button>
          )}
          <div className="menu-sep" />
          <button role="menuitem" type="button" onClick={() => void logout()}>
            <LogOut aria-hidden /> Sign out
          </button>
        </div>
      )}
      <FeedbackDialog open={feedback.open} screenshot={feedback.shot} map={map} onClose={() => setFeedback({ open: false, shot: null })} />
    </div>
  );
}
