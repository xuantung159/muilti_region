import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState } from './components/ui';
import { ApisPage } from './pages/ApisPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { OverviewPage } from './pages/OverviewPage';
import { RegionsPage } from './pages/RegionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { PortalPage } from './pages/PortalPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="portal" element={<PortalPage />} />
        <Route index element={<OverviewPage />} />
        <Route path="regions" element={<RegionsPage />} />
        <Route path="apis" element={<ApisPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <EmptyState title="Không tìm thấy trang">
              <Link to="/" className="underline">
                Về System Overview
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
