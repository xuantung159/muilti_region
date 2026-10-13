import { RefreshCw } from 'lucide-react';
import { useSettings } from '../app/settings';
import { formatDateTime } from '../domain/format';
import { RANGE_KEYS, RANGES } from '../domain/range';
import type { RangeKey } from '../domain/types';
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

export function LastUpdated({ at }: { at: number | null }) {
  return (
    <span className="text-xs text-ink2">
      Cập nhật gần nhất: <span className="font-medium text-ink">{at ? formatDateTime(at) : 'chưa có dữ liệu'}</span>
    </span>
  );
}

export function DataToolbar({ updatedAt, onRefresh, fetching }: { updatedAt: number | null; onRefresh: () => void; fetching: boolean }) {
  return (
    <>
      <LastUpdated at={updatedAt} />
      <RangeSelect />
      <div className="self-end">
        <Button onClick={onRefresh} icon={RefreshCw} label="Làm mới dữ liệu">
          {fetching ? 'Đang tải…' : 'Làm mới'}
        </Button>
      </div>
    </>
  );
}
