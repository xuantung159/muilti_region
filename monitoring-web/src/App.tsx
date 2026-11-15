import { ReportAccess } from './components/ReportAccess';
import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState } from './components/ui';
import { ApisPage } from './pages/ApisPage';
import { ErrorsPage } from './pages/ErrorsPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { InfrastructurePage } from './pages/InfrastructurePage';
import { OverviewPage } from './pages/OverviewPage';
import { RegionsPage } from './pages/RegionsPage';
import { RoutingPage } from './pages/RoutingPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { PortalPage } from './pages/PortalPage';
import { DemoPage } from './pages/DemoPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="portal" element={<PortalPage />} />
        <Route path="demo" element={<DemoPage />} />
        <Route index element={<ReportAccess><OverviewPage /></ReportAccess>} />
        <Route path="regions" element={<ReportAccess><RegionsPage /></ReportAccess>} />
        <Route path="routing" element={<ReportAccess><RoutingPage /></ReportAccess>} />
        <Route path="errors" element={<ReportAccess><ErrorsPage /></ReportAccess>} />
        <Route path="apis" element={<ReportAccess><ApisPage /></ReportAccess>} />
        <Route path="incidents" element={<ReportAccess><IncidentsPage /></ReportAccess>} />
        <Route path="infrastructure" element={<ReportAccess><InfrastructurePage /></ReportAccess>} />
        <Route path="sources" element={<ReportAccess><SourcesPage /></ReportAccess>} />
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
