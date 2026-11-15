import { readToken } from '../portal/client';
import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { MonitoringProvider } from '../data/provider';
import { createProvider } from '../data/providers';
import { ENV, useSettings } from './settings';

const ProviderContext = createContext<MonitoringProvider | null>(null);

// `provider` chỉ dùng trong test để thay nguồn dữ liệu.
export function DataProvider({ children, provider }: { children: ReactNode; provider?: MonitoringProvider }) {
  const { settings } = useSettings();
  const active = useMemo(() => provider ?? createProvider(settings.demoMode, ENV.backendUrl), [provider, settings.demoMode]);
  return <ProviderContext.Provider value={active}>{children}</ProviderContext.Provider>;
}

export function useProvider(): MonitoringProvider {
  const provider = useContext(ProviderContext);
  if (!provider) throw new Error('useProvider phải nằm trong DataProvider');
  return provider;
}

function useRefetchInterval(): number | false {
  const { settings } = useSettings();
  return settings.refreshSec > 0 ? settings.refreshSec * 1000 : false;
}

export function useSnapshot() {
  const provider = useProvider();
  const { settings } = useSettings();
  return useQuery({
    queryKey: [provider.id, readToken(), 'snapshot', settings.range, settings.keyId, settings.region],
    queryFn: () => provider.getSnapshot(settings.range, settings.keyId, settings.region),
    refetchInterval: useRefetchInterval(),
  });
}

export function useEndpoints() {
  const provider = useProvider();
  const { settings } = useSettings();
  return useQuery({
    queryKey: [provider.id, readToken(), 'endpoints', settings.range, settings.keyId],
    queryFn: () => provider.getEndpoints(settings.range, settings.keyId),
    refetchInterval: useRefetchInterval(),
  });
}

export function useRoutes() {
  const provider = useProvider();
  const { settings } = useSettings();
  return useQuery({
    queryKey: [provider.id, readToken(), 'routes', settings.range, settings.keyId],
    queryFn: () => provider.getRoutes(settings.range, settings.keyId),
    refetchInterval: useRefetchInterval(),
  });
}

export function useIncidents() {
  const provider = useProvider();
  return useQuery({ queryKey: [provider.id, readToken(), 'incidents'], queryFn: () => provider.getIncidents(), refetchInterval: useRefetchInterval() });
}

export function useSources() {
  const provider = useProvider();
  return useQuery({ queryKey: [provider.id, readToken(), 'sources'], queryFn: () => provider.getSources(), refetchInterval: useRefetchInterval() });
}
