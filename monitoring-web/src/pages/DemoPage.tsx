import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components/ui';
import { FailoverDemo } from '../demo/FailoverDemo';
import { GeoDemo } from '../demo/GeoDemo';
import { readToken } from '../portal/client';

// Trang tự kiểm thử: người chấm tự bấm để thấy định tuyến theo vị trí và failover giữa hai Region.
export function DemoPage() {
  const token = readToken();
  return (
    <>
      <PageHeader
        title="Kiểm thử đa Region"
        description="Tự gửi request từ các quốc gia khác nhau và tự giả lập một Region gặp sự cố để xem request được chuyển sang Region còn lại."
      />
      {!token ? (
        <EmptyState title="Cần đăng nhập để chạy kiểm thử">
          <Link className="text-accent underline" to="/portal">Đăng nhập hoặc đăng ký tại Cổng doanh nghiệp</Link>, sau đó quay lại trang này.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="demo-geo">
            <h2 id="demo-geo" className="mb-3 text-lg font-semibold text-ink">1. Gửi request từ quốc gia bất kỳ → Region gần nhất</h2>
            <GeoDemo token={token} />
          </section>
          <section aria-labelledby="demo-failover">
            <h2 id="demo-failover" className="mb-3 text-lg font-semibold text-ink">2. Một Region gặp lỗi → request tự chuyển sang Region còn lại</h2>
            <FailoverDemo token={token} />
          </section>
        </div>
      )}
    </>
  );
}
