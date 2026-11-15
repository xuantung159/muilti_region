// Thống kê cho load test: percentile, phân loại kết quả, tóm tắt.
//
// Phương pháp percentile: NEAREST-RANK trên toàn bộ mẫu thô đã gộp (không lấy trung bình của
// các percentile theo cửa sổ, không dùng histogram xấp xỉ).
//   1. Sắp xếp N mẫu tăng dần.
//   2. rank = ceil(p / 100 * N), kẹp trong [1, N].
//   3. Pp = sorted[rank - 1].
// Ưu điểm: giá trị trả về luôn là một mẫu đo thật (không nội suy), p100 = max, p0 = min.
// Lưu ý: k6 dùng nội suy tuyến tính nên với ít mẫu hai công cụ có thể lệch nhau một chút.

export function percentile(sortedAsc, p) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new RangeError(`percentile p phải trong [0, 100], nhận ${p}`);
  if (p === 0) return sortedAsc[0];
  const rank = Math.min(sortedAsc.length, Math.max(1, Math.ceil((p / 100) * sortedAsc.length)));
  return sortedAsc[rank - 1];
}

export function latencySummary(samples) {
  const xs = samples.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (xs.length === 0) return { count: 0, min: null, avg: null, p50: null, p90: null, p95: null, p99: null, max: null };
  const sum = xs.reduce((s, x) => s + x, 0);
  const r = v => Math.round(v * 100) / 100;
  return {
    count: xs.length,
    min: r(xs[0]),
    avg: r(sum / xs.length),
    p50: r(percentile(xs, 50)),
    p90: r(percentile(xs, 90)),
    p95: r(percentile(xs, 95)),
    p99: r(percentile(xs, 99)),
    max: r(xs[xs.length - 1]),
  };
}

// Mỗi kết quả request: { status?: number, error?: 'timeout' | 'connection' | 'other', latencyMs, ... }
export function classify(result) {
  if (result.error === 'timeout') return 'timeout';
  if (result.error) return 'connection';
  const s = result.status;
  if (s >= 200 && s < 300) return '2xx';
  if (s >= 300 && s < 400) return '3xx';
  if (s >= 400 && s < 500) return '4xx';
  if (s >= 500 && s < 600) return '5xx';
  return 'other';
}

export const isSuccess = result => { const c = classify(result); return c === '2xx' || c === '3xx'; };

export function summarize(results, { startedAt, endedAt } = {}) {
  const counts = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, timeout: 0, connection: 0, other: 0 };
  const statusCodes = {};
  const regions = {};
  for (const r of results) {
    counts[classify(r)] += 1;
    if (r.status) statusCodes[r.status] = (statusCodes[r.status] ?? 0) + 1;
    if (r.region) regions[r.region] = (regions[r.region] ?? 0) + 1;
  }
  const total = results.length;
  const ok = counts['2xx'] + counts['3xx'];
  const elapsedS = startedAt != null && endedAt != null ? Math.max(1e-9, (endedAt - startedAt) / 1000) : null;
  return {
    total,
    counts,
    statusCodes,
    throttled429: statusCodes[429] ?? 0,
    regions,
    errorRate: total ? Math.round(((total - ok) / total) * 10000) / 10000 : 0,
    elapsedS: elapsedS == null ? null : Math.round(elapsedS * 1000) / 1000,
    achievedRps: elapsedS == null ? null : Math.round((total / elapsedS) * 100) / 100,
    // Độ trễ tính trên MỌI request có phản hồi HTTP (kể cả 4xx/5xx); request timeout/lỗi kết nối
    // không có độ trễ có nghĩa nên chỉ được đếm ở counts.
    latencyMs: latencySummary(results.filter(r => !r.error).map(r => r.latencyMs)),
    ttfbMs: latencySummary(results.filter(r => !r.error).map(r => r.ttfbMs)),
    // Độ trễ riêng của request thành công (2xx/3xx), để so sánh đường đi không bị lẫn lỗi nhanh.
    successLatencyMs: latencySummary(results.filter(isSuccess).map(r => r.latencyMs)),
  };
}
