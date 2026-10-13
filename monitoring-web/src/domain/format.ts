import type { MissingReason, RangeKey } from './types';

const number = new Intl.NumberFormat('vi-VN');
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });

export const formatNumber = (n: number): string => number.format(Math.round(n));
export const formatCompact = (n: number): string => compact.format(n);
export const formatPct = (n: number): string => `${n.toFixed(n >= 99.95 || n === 0 ? 1 : 2)}%`;
export const formatMs = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);

export const MISSING_LABEL: Record<MissingReason, string> = {
  not_connected: 'Not connected',
  unavailable: 'Unavailable',
  not_configured: 'Not configured',
};

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatTick(ms: number, range: RangeKey): string {
  const d = new Date(ms);
  if (range === '7d') return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBucket(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} giây`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m} phút ${s} giây` : `${m} phút`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}
