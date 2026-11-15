import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useProvider } from '../app/data';
import { useSettings } from '../app/settings';
import { portalCall, readToken } from '../portal/client';
import { formatDateTime } from '../domain/format';
import { RANGE_KEYS, RANGES } from '../domain/range';
import { type RangeKey, type RegionFilter, REGIONS } from '../domain/types';
import { Button, Select } from './ui';

export function RangeSelect() {
  const { settings, update } = useSettings();
  return (
    <Select label="Khoảng thời gian" value={settings.range} onChange={(e) => update({ range: e.target.value as RangeKey })}>
      {RANGE_KEYS.map((key) => (
        <option key={key} value={key}>
          {RANGES[key].label}
        </option>
      ))}
    </Select>
  );
}

// Lọc phần tổng hợp của báo cáo theo Region phục vụ (tham số region của /api/report).
export function RegionSelect() {
  const { settings, update } = useSettings();
  return (
    <Select label="Region" value={settings.region} onChange={(e) => update({ region: e.target.value as RegionFilter })}>
      <option value="all">Cả hai Region</option>
      {REGIONS.map((r) => (
        <option key={r.code} value={r.code}>
          {r.name}
        </option>
      ))}
    </Select>
  );
}

type PortalKey = { keyId: string; name: string; status: string };

// Chọn API key cho mọi báo cáo. Chỉ có ý nghĩa với dữ liệu thật của doanh nghiệp đang đăng nhập;
// dữ liệu mẫu không chia theo key nên ẩn đi.
export function KeySelect() {
  const provider = useProvider();
  const { settings, update } = useSettings();
  const token = readToken();
  const enabled = provider.id === 'http' && !!token;
  const keys = useQuery({
    queryKey: ['report-keys', token],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) => portalCall<{ keys: PortalKey[] }>('keys', token, 'GET', undefined, signal),
  });
  const list = keys.data?.keys ?? [];
  // Key đã chọn không còn thuộc doanh nghiệp này (đăng nhập tài khoản khác): quay về "Tất cả".
  useEffect(() => {
    if (keys.data && settings.keyId !== 'all' && !list.some((k) => k.keyId === settings.keyId)) update({ keyId: 'all' });
  }, [keys.data, list, settings.keyId, update]);
  if (!enabled) return null;
  return (
    <Select label="API key" value={settings.keyId} onChange={(e) => update({ keyId: e.target.value })} className="max-w-[14rem]">
      <option value="all">Tất cả API key ({list.length})</option>
      {list.map((k) => (
        <option key={k.keyId} value={k.keyId}>
          {k.name}
          {k.status === 'active' ? '' : ' (đã thu hồi)'}
        </option>
      ))}
    </Select>
  );
}

export function LastUpdated({ at }: { at: number | null }) {
  return (
    <span className="text-xs text-ink2">
      Cập nhật gần nhất: <span className="font-medium text-ink">{at ? formatDateTime(at) : 'chưa có dữ liệu'}</span>
    </span>
  );
}

export function DataToolbar({ updatedAt, onRefresh, fetching, region = false }: { updatedAt: number | null; onRefresh: () => void; fetching: boolean; region?: boolean }) {
  return (
    <>
      <LastUpdated at={updatedAt} />
      <KeySelect />
      {region && <RegionSelect />}
      <RangeSelect />
      <div className="self-end">
        <Button onClick={onRefresh} icon={RefreshCw} label="Làm mới dữ liệu">
          {fetching ? 'Đang tải…' : 'Làm mới'}
        </Button>
      </div>
    </>
  );
}
