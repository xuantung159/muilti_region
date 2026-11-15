// Định nghĩa kịch bản dùng chung cho run.mjs, compare.mjs (và đồng bộ tay với k6/mrapi-load.js).
// Thời lượng có thể co giãn bằng PERF_DURATION_SCALE (vd 0.2 để thử nhanh).
// Mọi kịch bản tăng tải dần (ramp) và có ngưỡng abort.

const scale = () => { const s = Number(process.env.PERF_DURATION_SCALE ?? '1'); return Number.isFinite(s) && s > 0 ? s : 1; };
const st = (durationS, target) => ({ durationS: Math.max(1, Math.round(durationS * scale())), target });

export const SCENARIOS = {
  baseline: () => ({
    description: '1 VU, nghỉ 1 s giữa hai request (~1 RPS) trong 60 s: độ trễ nền khi hệ thống rảnh',
    mode: 'vus', vus: 1, durationS: Math.round(60 * scale()), thinkMs: 1000,
    abort: { errorRate: 0.2, p95Ms: 5000, minSamples: 10 },
  }),
  rps10: () => ({
    description: 'Tăng 1→10 RPS trong 15 s, giữ 10 RPS 60 s, giảm về 0 trong 5 s',
    mode: 'arrival', startRate: 1, stages: [st(15, 10), st(60, 10), st(5, 0)],
    abort: { errorRate: 0.05, p95Ms: 3000 },
  }),
  rps50: () => ({
    description: 'Tăng 1→10 RPS (15 s), 10→50 RPS (30 s), giữ 50 RPS 60 s, giảm 10 s',
    mode: 'arrival', startRate: 1, stages: [st(15, 10), st(30, 50), st(60, 50), st(10, 0)],
    abort: { errorRate: 0.05, p95Ms: 3000 },
  }),
  rps100: () => ({
    description: 'Bậc thang 10→50→100 RPS, giữ 100 RPS 60 s, giảm 10 s',
    mode: 'arrival', startRate: 1, stages: [st(15, 10), st(30, 50), st(30, 100), st(60, 100), st(10, 0)],
    abort: { errorRate: 0.05, p95Ms: 3000 },
  }),
  rps500: () => ({
    description: 'TẢI CAO (cần ALLOW_HIGH_LOAD=1): bậc thang 10→100→250→500 RPS, giữ 500 RPS 30 s',
    highLoad: true, mode: 'arrival', startRate: 1,
    stages: [st(15, 10), st(30, 100), st(30, 250), st(30, 500), st(30, 500), st(10, 0)],
    maxInFlight: 2000, abort: { errorRate: 0.02, p95Ms: 2000 },
  }),
  concurrent: () => ({
    description: '20 VU gửi liên tục không nghỉ trong 30 s (closed model): hành vi khi nhiều request đồng thời',
    mode: 'vus', vus: Number(process.env.PERF_VUS ?? 20), durationS: Math.round(30 * scale()), thinkMs: 0,
    abort: { errorRate: 0.1, p95Ms: 5000 },
  }),
  'upstream-timeout': () => ({
    description: 'Backend chậm: thêm ?delay=PERF_DELAY_MS (mặc định 6000 > timeoutMs 5000 của proxy) ở 2 RPS trong 30 s; kỳ vọng 504 UPSTREAM_TIMEOUT từ gateway',
    mode: 'arrival', startRate: 2, stages: [st(30, 2)], query: { delay: process.env.PERF_DELAY_MS ?? '6000' },
    timeoutMs: Number(process.env.PERF_TIMEOUT_MS ?? 35_000),
    abort: { disabled: true }, expectErrors: true,
  }),
  'region-failure': () => ({
    description: 'Chạy đều 2 RPS trong 15 phút qua entry (Route 53) và ghi timeline theo giây + X-Served-Region. KHÔNG tự kích hoạt sự cố: người chạy tự bật giả lập failover trên portal trong lúc chạy.',
    entryOnly: true, mode: 'arrival', startRate: 2, stages: [st(900, 2)],
    abort: { errorRate: 0.5, p95Ms: 10_000, windowS: 30, minSamples: 30 },
  }),
};

export function getScenario(name) {
  const f = SCENARIOS[name];
  if (!f) throw new Error(`Không có kịch bản "${name}". Có: ${Object.keys(SCENARIOS).join(', ')}`);
  return { name, ...f() };
}
