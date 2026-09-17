import { type CopyCatalog, copyFor } from '@wayfinder/shared/copy';
import { DEFAULT_APP_SETTINGS, type PublicConfig } from '@wayfinder/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { api } from './api';

const fallback: PublicConfig = { ...DEFAULT_APP_SETTINGS, osmDataDate: null };
const Ctx = createContext<{ config: PublicConfig; copy: CopyCatalog }>({ config: fallback, copy: copyFor('plain') });

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['config'], queryFn: () => api.request<PublicConfig>('api/config'), staleTime: 60_000, retry: 1 });
  const config = q.data ?? fallback;
  const value = useMemo(() => ({ config, copy: copyFor(config.voice) }), [config]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAppConfig = () => useContext(Ctx);
