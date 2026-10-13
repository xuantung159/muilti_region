import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { RANGE_KEYS } from '../domain/range';
import { type RangeKey, type RegionCode, REGIONS } from '../domain/types';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type RegionView = 'compare' | RegionCode;
export const REFRESH_OPTIONS = [0, 15, 30, 60] as const;

export interface Settings {
  range: RangeKey;
  defaultRegion: RegionView;
  refreshSec: (typeof REFRESH_OPTIONS)[number];
  demoMode: boolean;
  theme: ThemeSetting;
}

const STORAGE_KEY = 'monitoring-web.settings';

// Cấu hình lúc build. Chỉ chứa URL công khai, không bao giờ chứa thông tin xác thực.
export const ENV = {
  backendUrl: (import.meta.env.VITE_MONITORING_API_URL ?? '').trim(),
  defaultDemoMode: (import.meta.env.VITE_DEFAULT_DATA_MODE ?? 'mock') !== 'live',
};

export const DEFAULT_SETTINGS: Settings = {
  range: '6h',
  defaultRegion: 'compare',
  refreshSec: 30,
  demoMode: ENV.defaultDemoMode,
  theme: 'system',
};

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    const regionViews: RegionView[] = ['compare', ...REGIONS.map((r) => r.code)];
    return {
      range: RANGE_KEYS.includes(raw.range as RangeKey) ? (raw.range as RangeKey) : DEFAULT_SETTINGS.range,
      defaultRegion: regionViews.includes(raw.defaultRegion as RegionView) ? (raw.defaultRegion as RegionView) : DEFAULT_SETTINGS.defaultRegion,
      refreshSec: REFRESH_OPTIONS.includes(raw.refreshSec as 0) ? (raw.refreshSec as Settings['refreshSec']) : DEFAULT_SETTINGS.refreshSec,
      demoMode: typeof raw.demoMode === 'boolean' ? raw.demoMode : DEFAULT_SETTINGS.demoMode,
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: Settings;
  dark: boolean; // giao diện đang thực sự hiển thị, sau khi áp dụng thiết lập hệ điều hành
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Partial<Settings> }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...load(), ...initial }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
