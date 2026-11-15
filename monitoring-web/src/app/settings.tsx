import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { RANGE_KEYS } from '../domain/range';
import { type KeyFilter, type RangeKey, type RegionCode, type RegionFilter, REGIONS } from '../domain/types';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type RegionView = 'compare' | RegionCode;
export const REFRESH_OPTIONS = [0, 15, 30, 60] as const;

export interface Settings {
  range: RangeKey;
  // API key đang xem trong mọi báo cáo; 'all' = gộp mọi key của doanh nghiệp.
  keyId: KeyFilter;
  // Region phục vụ cho phần tổng hợp của báo cáo (KPI tổng, lỗi theo key, loại lỗi); 'all' = cả hai Region.
  region: RegionFilter;
  defaultRegion: RegionView;
  refreshSec: (typeof REFRESH_OPTIONS)[number];
  demoMode: boolean;
  theme: ThemeSetting;
}

export const STORAGE_KEY = 'monitoring-web.settings';
// Phiên bản định dạng lưu trong localStorage. Bản cũ (không có `v`) tự ghi cả demoMode mặc định lúc build,
// nên không phân biệt được người dùng có chủ động bật demo hay không.
const STORAGE_VERSION = 2;

// Chế độ dữ liệu mặc định khi người dùng chưa chọn trong Settings.
// Bản build production không có VITE_DEFAULT_DATA_MODE (ví dụ .env.production bị .gitignore bỏ qua) thì dùng dữ liệu thật,
// để khách truy cập app.multi-region.io.vn không thấy request mẫu như thể là số liệu AWS. Chỉ chạy dev mới mặc định mock.
export function resolveDefaultDemoMode(mode: string | undefined, production: boolean): boolean {
  const normalized = (mode ?? '').trim().toLowerCase();
  if (normalized === 'live') return false;
  if (normalized === 'mock') return true;
  return !production;
}

// Cấu hình lúc build. Chỉ chứa URL công khai, không bao giờ chứa thông tin xác thực.
export const ENV = {
  backendUrl: (import.meta.env.VITE_MONITORING_API_URL ?? '').trim(),
  defaultDemoMode: resolveDefaultDemoMode(import.meta.env.VITE_DEFAULT_DATA_MODE, import.meta.env.PROD),
};

export const DEFAULT_SETTINGS: Settings = {
  range: '6h',
  keyId: 'all',
  region: 'all',
  defaultRegion: 'compare',
  refreshSec: 30,
  demoMode: ENV.defaultDemoMode,
  theme: 'system',
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings> & { v?: number };
    const regionViews: RegionView[] = ['compare', ...REGIONS.map((r) => r.code)];
    return {
      range: RANGE_KEYS.includes(raw.range as RangeKey) ? (raw.range as RangeKey) : DEFAULT_SETTINGS.range,
      keyId: typeof raw.keyId === 'string' && /^(all|[a-f0-9]{12})$/.test(raw.keyId) ? raw.keyId : DEFAULT_SETTINGS.keyId,
      region: REGIONS.some((r) => r.code === raw.region) ? (raw.region as RegionCode) : 'all',
      defaultRegion: regionViews.includes(raw.defaultRegion as RegionView) ? (raw.defaultRegion as RegionView) : DEFAULT_SETTINGS.defaultRegion,
      refreshSec: REFRESH_OPTIONS.includes(raw.refreshSec as 0) ? (raw.refreshSec as Settings['refreshSec']) : DEFAULT_SETTINGS.refreshSec,
      // Chỉ tin demoMode do người dùng chủ động chọn (định dạng v2). Giá trị cũ có thể là mặc định "mock" của bản build trước,
      // nếu giữ lại thì trình duyệt đó hiện dữ liệu mẫu mãi dù bản production đã chuyển sang live.
      demoMode: raw.v === STORAGE_VERSION && typeof raw.demoMode === 'boolean' ? raw.demoMode : DEFAULT_SETTINGS.demoMode,
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// demoMode chỉ được lưu khi khác mặc định lúc build, tức là người dùng đã chủ động đổi trong Settings.
export function serializeSettings(settings: Settings): string {
  const { demoMode, ...rest } = settings;
  return JSON.stringify({ v: STORAGE_VERSION, ...rest, ...(demoMode !== DEFAULT_SETTINGS.demoMode ? { demoMode } : {}) });
}

interface SettingsContextValue {
  settings: Settings;
  dark: boolean; // giao diện đang thực sự hiển thị, sau khi áp dụng thiết lập hệ điều hành
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Partial<Settings> }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...loadSettings(), ...initial }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeSettings(settings));
    } catch {
      // Trình duyệt chặn localStorage: thiết lập chỉ sống trong phiên này.
    }
  }, [settings]);

  const [systemDark, setSystemDark] = useState(() => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media?.addEventListener('change', onChange);
    return () => media?.removeEventListener('change', onChange);
  }, []);

  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const context = useMemo<SettingsContextValue>(
    () => ({
      settings,
      dark,
      update: (patch) => setSettings((current) => ({ ...current, ...patch })),
      reset: () => setSettings(DEFAULT_SETTINGS),
    }),
    [settings, dark],
  );

  return <SettingsContext.Provider value={context}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings phải nằm trong SettingsProvider');
  return context;
}
