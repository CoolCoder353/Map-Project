import type { AuthResponse, LoginRequest, PublicUser, RegisterRequest } from '@wayfinder/shared';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onAuthChange, refreshSession, setSession } from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: Status;
  user: PublicUser | null;
  login(input: LoginRequest): Promise<void>;
  register(input: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  setUser(user: PublicUser): void;
  /** True after this person chose to sign out (not when a session merely expired). */
  signedOut: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const off = onAuthChange((auth) => {
      setUserState(auth?.user ?? null);
      setStatus(auth ? 'authenticated' : 'anonymous');
    });
    void refreshSession().then((auth) => {
      if (!auth) setStatus('anonymous');
    });
    return () => {
      off();
    };
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    setSession(await api<AuthResponse>('/api/auth/login', { method: 'POST', body: input }));
    setSignedOut(false);
  }, []);
  const register = useCallback(async (input: RegisterRequest) => {
    setSession(await api<AuthResponse>('/api/auth/register', { method: 'POST', body: input }));
    setSignedOut(false);
  }, []);
  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    setSignedOut(true);
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, login, register, logout, setUser: setUserState, signedOut }),
    [status, user, login, register, logout, signedOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
