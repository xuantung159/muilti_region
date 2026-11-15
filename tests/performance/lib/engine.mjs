// Bộ chạy tải không cần cài thêm gì (Node >= 18: fetch + performance.now()).
//
// Hai kiểu tải:
//   - 'arrival' (open model): số request/giây theo các stage, tăng/giảm tuyến tính giữa các stage
//     (giống k6 ramping-arrival-rate). Request được bắn theo lịch dù request trước chưa xong;
//     nếu số request đang bay chạm maxInFlight thì phần vượt bị bỏ và đếm vào droppedIterations
//     (dấu hiệu máy chạy test hoặc hệ thống đích đã bão hoà).
//   - 'vus' (closed model): N "người dùng ảo" chạy song song, mỗi người gửi xong mới gửi tiếp
//     (có thể nghỉ thinkMs). Dùng cho baseline và kịch bản concurrent.
//
// Ngưỡng dừng sớm (abort): mỗi giây xét các request hoàn tất trong windowS giây gần nhất; nếu đủ
// minSamples mà tỉ lệ lỗi > errorRate hoặc p95 > p95Ms thì ngừng phát request mới, chờ request đang
// bay xong rồi trả kết quả với aborted = { reason }.
import { performance } from 'node:perf_hooks';
import { latencySummary, isSuccess, summarize, classify } from './stats.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Số request kỳ vọng đã phát tại giây t (tích phân của rate theo thời gian).
export function expectedArrivals(stages, t, startRate = 0) {
  let acc = 0; let from = startRate; let elapsed = 0;
  for (const { durationS, target } of stages) {
    if (t <= elapsed + durationS) {
      const x = t - elapsed;
      return acc + from * x + ((target - from) * x * x) / (2 * durationS);
    }
    acc += ((from + target) / 2) * durationS;
    elapsed += durationS; from = target;
  }
  return acc;
}

export const totalDuration = stages => stages.reduce((s, x) => s + x.durationS, 0);
export const peakRate = (stages, startRate = 0) => Math.max(startRate, ...stages.map(s => s.target));

export function makeRequester({ url, method = 'GET', headers = {}, body, timeoutMs = 10_000 }) {
  return async function once(startWall) {
    const t0 = performance.now();
    const startOffsetMs = Date.now() - startWall;
    try {
      const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const ttfbMs = performance.now() - t0;
      await res.arrayBuffer();
      return { t: startOffsetMs, status: res.status, latencyMs: performance.now() - t0, ttfbMs,
        region: res.headers.get('x-served-region') ?? undefined, source: res.headers.get('x-mrapi-source') ?? undefined };
    } catch (err) {
      const name = err?.name ?? ''; const causeName = err?.cause?.name ?? '';
      const timeout = name === 'TimeoutError' || causeName === 'TimeoutError' || name === 'AbortError';
      return { t: startOffsetMs, error: timeout ? 'timeout' : 'connection', code: err?.cause?.code ?? err?.code ?? name,
        elapsedMs: performance.now() - t0 };
    }
  };
}

export async function run(options) {
  const { mode = 'arrival', stages = [], startRate = 0, vus = 1, durationS = 10, thinkMs = 0,
    maxInFlight = 1000, abort = {}, onTick, request } = options;
  const once = request ?? makeRequester(options);
  const abortCfg = { errorRate: 0.1, p95Ms: 3000, windowS: 5, minSamples: 20, ...abort };
  const results = []; const inflight = new Set();
  let stopped = false; let aborted = null; let issued = 0; let dropped = 0;
  const startWall = Date.now(); const start = performance.now();

  const fire = () => {
    const p = once(startWall).then(r => { results.push({ ...r, doneAt: performance.now() }); inflight.delete(p); });
    inflight.add(p);
  };

  const checker = setInterval(() => {
    const now = performance.now();
    const recent = results.filter(r => now - r.doneAt <= abortCfg.windowS * 1000);
    if (onTick) onTick({ elapsedS: (now - start) / 1000, done: results.length, inflight: inflight.size, dropped });
    if (abortCfg.disabled || recent.length < abortCfg.minSamples || aborted) return;
    const errRate = recent.filter(r => !isSuccess(r)).length / recent.length;
    const p95 = latencySummary(recent.filter(r => !r.error).map(r => r.latencyMs)).p95;
    if (errRate > abortCfg.errorRate) aborted = { reason: `error rate ${(errRate * 100).toFixed(1)}% > ${(abortCfg.errorRate * 100).toFixed(1)}% (cửa sổ ${abortCfg.windowS}s)`, atS: (now - start) / 1000 };
    else if (p95 != null && p95 > abortCfg.p95Ms) aborted = { reason: `p95 ${p95.toFixed(0)} ms > ${abortCfg.p95Ms} ms (cửa sổ ${abortCfg.windowS}s)`, atS: (now - start) / 1000 };
    if (aborted) stopped = true;
  }, 1000);

  if (mode === 'arrival') {
    const total = totalDuration(stages);
    while (!stopped) {
      const t = (performance.now() - start) / 1000;
      if (t >= total) break;
      const due = Math.floor(expectedArrivals(stages, t, startRate));
      while (issued < due) {
        if (inflight.size >= maxInFlight) { dropped += due - issued; issued = due; break; }
        fire(); issued += 1;
      }
      await sleep(2);
    }
  } else if (mode === 'vus') {
    const endAt = start + durationS * 1000;
    const worker = async () => {
      while (!stopped && performance.now() < endAt) {
        issued += 1;
        const r = await once(startWall);
        results.push({ ...r, doneAt: performance.now() });
        if (thinkMs > 0) await sleep(thinkMs);
      }
    };
    await Promise.all(Array.from({ length: vus }, worker));
  } else throw new Error(`mode không hợp lệ: ${mode}`);

  await Promise.all([...inflight]);
  clearInterval(checker);
  const end = performance.now();
  const summary = summarize(results, { startedAt: start, endedAt: end });
  return { summary: { ...summary, issued, droppedIterations: dropped }, aborted, timeline: timeline(results), results };
}

// Gộp theo giây (theo thời điểm BẮT ĐẦU request): dùng cho kịch bản failover để thấy lúc nào
// Region phục vụ đổi và lúc nào có lỗi.
export function timeline(results) {
  const buckets = new Map();
  for (const r of results) {
    const s = Math.floor(r.t / 1000);
    const b = buckets.get(s) ?? { second: s, sent: 0, ok: 0, errors: 0, classes: {}, regions: {}, lat: [] };
    b.sent += 1;
    const c = classify(r); b.classes[c] = (b.classes[c] ?? 0) + 1;
    if (isSuccess(r)) b.ok += 1; else b.errors += 1;
    if (r.region) b.regions[r.region] = (b.regions[r.region] ?? 0) + 1;
    if (!r.error) b.lat.push(r.latencyMs);
    buckets.set(s, b);
  }
  return [...buckets.values()].sort((a, b) => a.second - b.second)
    .map(({ lat, ...b }) => ({ ...b, p50Ms: latencySummary(lat).p50, p95Ms: latencySummary(lat).p95 }));
}
