import { RotateCcw } from 'lucide-react';
import { ENV, REFRESH_OPTIONS, type RegionView, type Settings, type ThemeSetting, useSettings } from '../app/settings';
import { RangeSelect } from '../components/Toolbar';
import { Button, Card, PageHeader, Select } from '../components/ui';
import { REGIONS } from '../domain/types';

export function SettingsPage() {
  const { settings, update, reset } = useSettings();

  return (
    <>
      <PageHeader title="Settings" description="Thiết lập hiển thị, lưu trong trình duyệt này." actions={<Button onClick={reset} icon={RotateCcw}>Khôi phục mặc định</Button>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">Hiển thị</h2>
          <RangeSelect />
          <Select label="Region mặc định ở trang Multi-Region" value={settings.defaultRegion} onChange={(e) => update({ defaultRegion: e.target.value as RegionView })}>
            <option value="compare">So sánh hai Region</option>
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name} ({r.code})
              </option>
            ))}
          </Select>
          <Select label="Chu kỳ refresh" value={settings.refreshSec} onChange={(e) => update({ refreshSec: Number(e.target.value) as Settings['refreshSec'] })}>
            {REFRESH_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'Tắt tự động refresh' : `${s} giây`}
              </option>
            ))}
          </Select>
          <Select label="Giao diện" value={settings.theme} onChange={(e) => update({ theme: e.target.value as ThemeSetting })}>
            <option value="system">Theo hệ điều hành</option>
            <option value="light">Sáng</option>
            <option value="dark">Tối</option>
          </Select>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">Nguồn dữ liệu</h2>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 size-4" checked={settings.demoMode} onChange={(e) => update({ demoMode: e.target.checked })} />
            <span>
              <span className="font-medium">Chế độ dữ liệu demo</span>
              <span className="block text-xs text-ink2">Bật: dùng dữ liệu mẫu sinh trong trình duyệt. Tắt: chỉ hiển thị dữ liệu từ backend; nếu chưa cấu hình backend, mọi metric hiện "Not connected".</span>
            </span>
          </label>

          <div className="text-xs">
            <div className="font-medium text-ink2">Endpoint backend (biến môi trường VITE_MONITORING_API_URL)</div>
            <div className="mt-1 break-all rounded-md border border-line bg-raised px-2 py-1.5 font-mono text-ink">{ENV.backendUrl || 'Chưa cấu hình'}</div>
            <p className="mt-2 text-ink2">Giá trị này đặt trong file <code>.env.local</code> lúc build, không sửa được trên giao diện. Xem <code>.env.example</code>.</p>
          </div>

          <p className="rounded-md border border-line px-3 py-2 text-xs text-ink2">
            Dashboard không nhận AWS access key, secret key hay session token. Trình duyệt chỉ gọi backend; backend dùng IAM role để đọc AWS.
          </p>
        </Card>
      </div>
    </>
  );
}
