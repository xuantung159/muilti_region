import type { ReactNode } from 'react';
import { formatMs, formatNumber } from '../domain/format';
import { type LatencyComponent, latencyComponents } from '../domain/report';
import type { LatencyBreakdown as Breakdown, LatencyStats } from '../domain/types';
import { Card, NotAvailable } from './ui';

const COLORS: Record<LatencyComponent['key'], string> = {
  gateway: 'var(--accent-2)',
  upstream: 'var(--series-1)',
  connect: 'var(--series-1)',
  ttfb: 'var(--series-1)',
  total: 'var(--accent)',
};

export interface BreakdownGroup {
  label: string;
  latency?: LatencyStats;
  breakdown?: Breakdown;
}

// Một nhóm (một Region hoặc toàn bộ): thanh ngang theo avg, kèm p95 và số mẫu của từng thành phần.
function Group({ group, scale }: { group: BreakdownGroup; scale: number }) {
  const parts = latencyComponents(group.latency, group.breakdown);
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{group.label}</div>
      {parts.length === 0 ? (
        <p className="mt-1 text-xs text-ink2">
          <NotAvailable /> Chưa có mẫu nào có thời gian tách.
        </p>
      ) : (
        <ul className="mt-2 space-y-2" aria-label={`Thành phần độ trễ ${group.label}`}>
          {parts.map((p) => (
            <li key={p.key} className="text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-ink2">
                <span className={p.key === 'connect' || p.key === 'ttfb' ? 'pl-3' : 'font-medium text-ink'}>{p.label}</span>
                <span className="tabular-nums">
                  <span className="font-semibold text-ink">avg {formatMs(p.avgMs)}</span>
                  {' · '}p95 {p.p95Ms === null ? 'N/A' : formatMs(p.p95Ms)}
                  {' · '}
                  {formatNumber(p.samples)} mẫu
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(1, (p.avgMs / scale) * 100)}%`, background: COLORS[p.key], opacity: p.key === 'connect' || p.key === 'ttfb' ? 0.55 : 1 }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LatencyBreakdownCard({ groups, badge }: { groups: BreakdownGroup[]; badge?: ReactNode }) {
  const all = groups.flatMap((g) => latencyComponents(g.latency, g.breakdown));
  const scale = Math.max(1, ...all.map((p) => p.avgMs));
  const anySplit = all.some((p) => p.key !== 'total');
  return (
    <Card>
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        Độ trễ: gateway và upstream
        {badge}
      </h2>
      <p className="mt-0.5 text-xs text-ink2">
        Thời gian chờ upstream gồm thời gian backend của doanh nghiệp xử lý cộng mạng giữa gateway và backend (DNS, TCP, TLS, truyền dữ liệu). Tổng thời gian tại gateway không gồm mạng
        client → API Gateway, authorizer, cold start và bước ghi telemetry.
      </p>
      {!anySplit && (
        <p className="mt-3 rounded-md border border-dashed border-line px-3 py-2 text-xs text-ink2">
          <NotAvailable /> Backend chưa trả thời gian tách gateway/upstream (cần telemetry định dạng mới). Không suy ra từ số khác.
        </p>
      )}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <Group key={g.label} group={g} scale={scale} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Mỗi thành phần có số mẫu riêng: chỉ request ghi theo định dạng mới mới có thời gian tách; request bị gateway từ chối (4xx) không gọi backend nên không có thời gian upstream; kết nối mới chỉ
        đo khi không dùng lại socket.
      </p>
    </Card>
  );
}
