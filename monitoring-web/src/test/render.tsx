import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { DataProvider } from '../app/data';
import { type Settings, SettingsProvider } from '../app/settings';
import type { MonitoringProvider } from '../data/provider';

export function renderApp(provider: MonitoringProvider, route = '/', settings: Partial<Settings> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsProvider initial={{ refreshSec: 0, ...settings }}>
        <DataProvider provider={provider}>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </DataProvider>
      </SettingsProvider>
    </QueryClientProvider>,
  );
}
