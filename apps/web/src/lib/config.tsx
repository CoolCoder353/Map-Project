import { type CopyCatalog, DEFAULT_APP_SETTINGS, type PublicConfig, copyFor } from '@wayfinder/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { api } from './api';

interface ConfigValue {
  config: PublicConfig;
  copy: CopyCatalog;
}

const fallback: PublicConfig = { ...DEFAULT_APP_SETTINGS, osmDataDate: null };
const ConfigContext = createContext<ConfigValue>({ config: fallback, copy: copyFor('plain') });

export const configQueryKey = ['config'] as const;

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: configQueryKey,
    queryFn: () => api<PublicConfig>('/api/config'),
    staleTime: 60_000,
  });
  const config = data ?? fallback;
  useEffect(() => {
    document.title = config.appName;
  }, [config.appName]);
  const value = useMemo(() => ({ config, copy: copyFor(config.voice) }), [config]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export const useAppConfig = () => useContext(ConfigContext);
