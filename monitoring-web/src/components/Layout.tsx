import { Activity, Database, FlaskConical, Globe2, LayoutDashboard, type LucideIcon, Menu, Moon, Network, PlugZap, Settings as SettingsIcon, Siren, Sun, Unplug, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useProvider } from '../app/data';
import { useSettings } from '../app/settings';
import type { MonitoringProvider } from '../data/provider';
import { Tag } from './ui';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/portal', label: 'Cổng doanh nghiệp', icon: PlugZap },
  { to: '/', label: 'System Overview', icon: LayoutDashboard },
  { to: '/regions', label: 'Multi-Region', icon: Globe2 },
  { to: '/apis', label: 'API Monitoring', icon: Activity },
  { to: '/incidents', label: 'Failover & Incidents', icon: Siren },
  { to: '/infrastructure', label: 'Hạ tầng', icon: Network },
  { to: '/sources', label: 'Data Sources', icon: Database },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

// Nhãn trạng thái dữ liệu, luôn hiển thị ở header để không ai nhầm dữ liệu mẫu với số liệu thật.
export function DataModeBadge({ provider }: { provider: MonitoringProvider['id'] }) {
  if (provider === 'mock')
    return (
      <Tag tone="warning">
        <FlaskConical aria-hidden className="size-3" />
        Demo data
      </Tag>
    );
  if (provider === 'http')
    return (
      <Tag tone="accent">
        <PlugZap aria-hidden className="size-3" />
        Live · backend
      </Tag>
    );
  return (
    <Tag>
      <Unplug aria-hidden className="size-3" />
      Not connected
    </Tag>
  );
}

export function Layout() {
  const portal = useLocation().pathname === '/portal';
  const [menuOpen, setMenuOpen] = useState(false);
  const provider = useProvider();
  const { settings, update, dark } = useSettings();

  return (
    <div className="min-h-screen bg-page text-ink lg:flex">
      {menuOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-on-accent">
              <Globe2 aria-hidden className="size-4" />
            </span>
            Multi-Region Platform
          </span>
          <button type="button" className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Đóng menu">
            <X className="size-5" />
          </button>
        </div>
        <nav aria-label="Điều hướng chính" className="space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${isActive ? 'border-accent bg-accent/10 font-semibold text-ink' : 'border-transparent text-ink2 hover:bg-raised hover:text-ink'}`
              }
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 space-y-1 border-t border-line p-4 text-xs text-muted">
          <p className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-[var(--series-1)]" />
            ap-southeast-1
          </p>
          <p className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-[var(--series-2)]" />
            ap-northeast-1
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur">
          <button type="button" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Mở menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">AWS Multi-Region Active-Active API Platform</div>
          {portal ? <Tag tone="accent">Cổng doanh nghiệp</Tag> : <DataModeBadge provider={provider.id} />}
          <button
            type="button"
            onClick={() => update({ theme: dark ? 'light' : 'dark' })}
            aria-label={dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            title={`Giao diện: ${settings.theme}`}
            className="rounded-md border border-line p-2 hover:bg-raised"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </header>

        {!portal && provider.id === 'mock' && (
          <div className="border-b border-line bg-raised px-4 py-2 text-xs text-ink2">
            <strong className="font-semibold text-ink">DEMO DATA.</strong> Mọi số liệu trên trang được sinh trong trình duyệt để trình diễn, không lấy từ AWS.
          </div>
        )}
        {!portal && provider.id === 'none' && (
          <div className="border-b border-line bg-raised px-4 py-2 text-xs text-ink2">
            <strong className="font-semibold text-ink">NOT CONNECTED.</strong> Chế độ demo đang tắt và chưa cấu hình backend (<code>VITE_MONITORING_API_URL</code>), nên không có số liệu nào để hiển thị.
          </div>
        )}

        <main className="mx-auto max-w-7xl p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
