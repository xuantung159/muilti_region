import { useState } from 'react';
import { Card, HealthBadge, Tag } from '../components/ui';

type Scenario = 'normal' | 'sg' | 'tyo';
const SCENARIOS: [Scenario, string, string][] = [
  ['normal', 'Cả hai Region khỏe', 'Hai Region cùng nhận traffic. Route 53 đưa mỗi client tới Region có độ trễ thấp hơn với client đó.'],
  ['sg', 'Giả sử Singapore lỗi', 'Health check Singapore thất bại nên Route 53 ngừng trả về Region này. Client mới được đưa sang Tokyo; DNS cache làm thời điểm chuyển của mỗi client khác nhau.'],
  ['tyo', 'Giả sử Tokyo lỗi', 'Health check Tokyo thất bại nên Route 53 ngừng trả về Region này. Client mới được đưa sang Singapore; dữ liệu vẫn có nhờ bảng replica.'],
];

function RegionBox({ name, code, down, color }: { name: string; code: string; down: boolean; color: string }) {
  return <div className={`min-w-0 space-y-2 rounded-xl border p-3 transition-colors ${down ? 'border-critical bg-critical/10' : 'border-line bg-raised'}`}>
    <div className="flex items-center gap-2"><span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} /><p className="truncate text-sm font-semibold">{name}</p></div>
    <p className="break-all text-xs text-muted">{code}</p>
    <HealthBadge health={down ? 'down' : 'healthy'} label={down ? 'Health check lỗi' : 'Health check OK'} />
    <p className="text-xs text-ink2">API Gateway → Lambda → DynamoDB</p>
  </div>;
}

export function FailoverDiagram() {
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [, , explain] = SCENARIOS.find(([id]) => id === scenario) ?? SCENARIOS[0];
  const line = (x: number, down: boolean) => <path className={down ? undefined : 'flow-line'} d={`M50 0 C50 18 ${x} 12 ${x} 30`} fill="none" stroke={down ? 'var(--critical)' : x < 50 ? 'var(--series-1)' : 'var(--series-2)'} strokeWidth="2" strokeDasharray={down ? '4 6' : undefined} opacity={down ? 0.5 : 1} vectorEffect="non-scaling-stroke" />;
  return <Card className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Hai Region và failover</h2><Tag tone="warning">Minh họa, không phải trạng thái thật</Tag></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn tình huống minh họa">
      {SCENARIOS.map(([id, label]) => <button type="button" key={id} aria-pressed={scenario === id} onClick={() => setScenario(id)} className={`chip ${scenario === id ? 'chip-active' : ''}`}>{label}</button>)}
    </div>
    <div>
      <div className="mx-auto w-fit rounded-xl border border-line bg-raised px-4 py-2 text-center"><p className="text-sm font-semibold">Route 53</p><p className="text-xs text-muted">Latency + health check</p></div>
      <svg aria-hidden viewBox="0 0 100 30" preserveAspectRatio="none" className="h-12 w-full">{line(25, scenario === 'sg')}{line(75, scenario === 'tyo')}</svg>
      <div className="grid grid-cols-2 gap-3">
        <RegionBox name="Singapore" code="ap-southeast-1" down={scenario === 'sg'} color="var(--series-1)" />
        <RegionBox name="Tokyo" code="ap-northeast-1" down={scenario === 'tyo'} color="var(--series-2)" />
      </div>
      <p className="mt-3 rounded-xl border border-dashed border-line p-2 text-center text-xs text-ink2">DynamoDB Global Tables và S3 replication giữ bản sao dữ liệu ở cả hai Region</p>
    </div>
    <p aria-live="polite" className="rounded-xl bg-raised p-3 text-sm text-ink2">{explain}</p>
    <p className="text-xs text-muted">Sơ đồ này chỉ đổi trong trình duyệt, không tác động AWS. Số liệu thật nằm ở trang Multi-Region và Failover &amp; Incidents.</p>
  </Card>;
}
