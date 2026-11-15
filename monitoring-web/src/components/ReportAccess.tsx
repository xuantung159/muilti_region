import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useProvider } from '../app/data';
import { useSettings } from '../app/settings';
import { portalCall, PortalError, readToken, saveToken } from '../portal/client';
import { Card } from './ui';

// Ô thay cho báo cáo khi chưa có quyền xem. Luôn có nút xem ngay bằng dữ liệu demo,
// để người lần đầu vào (vd. người chấm) không phải đăng ký mới thấy được dashboard.
function Locked({ title, text, linkLabel }: { title: string; text: string; linkLabel: string }) {
  const { update } = useSettings();
  return <Card>
    <h1 className="text-lg font-semibold">{title}</h1>
    <p className="mt-2 text-sm text-ink2">{text}</p>
    <p className="mt-2 text-sm text-ink2">Dashboard giám sát nền tảng API chạy active-active trên hai Region AWS (Singapore và Tokyo): lưu lượng, độ trễ, lỗi, định tuyến theo vị trí và failover.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className="btn-primary min-h-10" onClick={() => update({ demoMode: true })}>Xem ngay bằng dữ liệu demo</button>
      <Link className="portal-btn" to="/portal">{linkLabel}</Link>
    </div>
    <p className="mt-3 text-xs text-muted">Dữ liệu demo sinh trong trình duyệt, không gọi AWS. Tắt lại trong Settings → Chế độ dữ liệu demo.</p>
  </Card>;
}

export function ReportAccess({ children }: { children: ReactNode }) {
  const provider = useProvider();
  const token = readToken();
  const access = useQuery({ queryKey: ['report-access', token], enabled: provider.id === 'http' && !!token,
    queryFn: ({ signal }) => portalCall<{ keys: { status: string }[] }>('keys', token, 'GET', undefined, signal),
    retry: false, staleTime: 0, refetchInterval: 15000 });
  useEffect(() => {
    if (access.error instanceof PortalError && access.error.status === 401) saveToken(null);
  }, [access.error]);
  if (provider.id !== 'http') return children;
  if (!token || (access.error instanceof PortalError && access.error.status === 401)) return <Locked title="Đăng nhập để xem báo cáo" text="Báo cáo số liệu thật yêu cầu tài khoản doanh nghiệp và API key còn hoạt động." linkLabel="Đăng nhập / Đăng ký" />;
  if (access.isPending) return <Card>Đang kiểm tra quyền xem báo cáo…</Card>;
  if (access.error) return <Card><p role="alert">Không xác minh được quyền xem báo cáo.</p><button className="mt-2 underline" onClick={() => void access.refetch()}>Thử lại</button></Card>;
  if (!access.data?.keys.some(key => key.status === 'active')) return <Locked title="Đăng ký API key để xem báo cáo" text="Tạo API đích và API key còn hoạt động trong cổng doanh nghiệp." linkLabel="Quản lý API key" />;
  return children;
}
