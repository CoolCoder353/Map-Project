import type { AuthResponse, PublicUser } from '@wayfinder/shared/schemas';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { reconcileTracking } from '../tracking/background';
import { api, onSession } from './api';
import { useAppConfig } from './appConfig';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  status: Status;
  user: PublicUser | null;
  setUser(u: PublicUser): void;
  signIn(email: string, password: string): Promise<void>;
  register(code: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const { config } = useAppConfig();

  useEffect(() => {
    const off = onSession((auth: AuthResponse | null) => {
      setUser(auth?.user ?? null);
      setStatus(auth ? 'authenticated' : 'anonymous');
    });
    void api.refresh().then((auth) => {
      if (!auth) setStatus('anonymous');
    });
    return off;
  }, []);

  // Keep background tracking in line with the account setting on this device.
  useEffect(() => {
    if (user) void reconcileTracking(user.settings.trackingEnabled, config.appName).catch(() => undefined);
  }, [user?.settings.trackingEnabled, user, config.appName]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      setUser,
      signIn: async (email, password) => void (await api.login(email, password)),
      register: async (code, email, password) => void (await api.register(code, email, password)),
      signOut: async () => {
        await reconcileTracking(false, config.appName).catch(() => undefined);
        await api.logout();
      },
    }),
    [status, user, config.appName],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
