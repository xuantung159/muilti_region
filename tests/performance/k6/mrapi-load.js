// Bản k6 của các kịch bản trong tests/performance/scenarios.mjs (giữ đồng bộ tay).
// k6 CHƯA được cài trên máy phát triển, script này CHƯA được chạy lần nào.
//
//   k6 run -e SCENARIO=rps10 -e TARGET=sg tests/performance/k6/mrapi-load.js
//   k6 run -e SCENARIO=baseline -e BASE_URL=http://127.0.0.1:18080 tests/performance/k6/mrapi-load.js
//
// Biến (-e hoặc biến môi trường): SCENARIO, TARGET (direct|sg|tokyo|entry) hoặc BASE_URL,
// BASE_URL_DIRECT/SG/TOKYO/ENTRY, API_ID, API_KEY, PERF_PATH, PERF_METHOD, PERF_BODY, PERF_DELAY_MS,
// PERF_CONFIRM_OWNED=1 (bắt buộc với host không phải local), ALLOW_HIGH_LOAD=1 (bắt buộc với rps500).
// Lưu ý: percentile của k6 dùng nội suy tuyến tính, runner Node dùng nearest-rank.
import http from 'k6/http';
import { check, sleep } from 'k6';

const E = __ENV;
const NAME = E.SCENARIO || 'baseline';
const TARGET_ENV = { direct: 'BASE_URL_DIRECT', sg: 'BASE_URL_SG', tokyo: 'BASE_URL_TOKYO', entry: 'BASE_URL_ENTRY' };
const gateway = !E.BASE_URL && E.TARGET && E.TARGET !== 'direct';
const base = (E.BASE_URL || E[TARGET_ENV[E.TARGET]] || '').replace(/\/$/, '');
if (!base) throw new Error('Đặt BASE_URL hoặc TARGET + BASE_URL_<TARGET>');
const host = base.replace(/^https?:\/\//, '').split(/[/:]/)[0];
const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
if (!local && E.PERF_CONFIRM_OWNED !== '1') throw new Error(`Host ${host} không phải local: chỉ test endpoint của dự án, đặt PERF_CONFIRM_OWNED=1`);

let path = E.PERF_PATH || '/orders';
if (gateway) { if (!E.API_ID || !E.API_KEY) throw new Error('Đích gateway cần API_ID và API_KEY'); path = `/proxy/${E.API_ID}${path}`; }
const url = base + path + (NAME === 'upstream-timeout' ? `${path.includes('?') ? '&' : '?'}delay=${E.PERF_DELAY_MS || '6000'}` : '');
const headers = { 'User-Agent': 'mrapi-perf-k6/1.0' };
if (gateway) headers['x-api-key'] = E.API_KEY;
if (E.PERF_BODY) headers['Content-Type'] = 'application/json';

const arrival = (stages, startRate, maxVUs = 200) => ({ executor: 'ramping-arrival-rate', startRate, timeUnit: '1s',
  preAllocatedVUs: Math.min(50, maxVUs), maxVUs, stages: stages.map(([d, t]) => ({ duration: `${d}s`, target: t })) });

const SCENARIOS = {
  baseline: { executor: 'constant-vus', vus: 1, duration: '60s' },
  rps10: arrival([[15, 10], [60, 10], [5, 0]], 1),
  rps50: arrival([[15, 10], [30, 50], [60, 50], [10, 0]], 1),
  rps100: arrival([[15, 10], [30, 50], [30, 100], [60, 100], [10, 0]], 1, 400),
  rps500: arrival([[15, 10], [30, 100], [30, 250], [30, 500], [30, 500], [10, 0]], 1, 2000),
  concurrent: { executor: 'constant-vus', vus: Number(E.PERF_VUS || 20), duration: '30s' },
  'upstream-timeout': arrival([[30, 2]], 2, 100),
  'region-failure': arrival([[900, 2]], 2, 100),
};
if (!SCENARIOS[NAME]) throw new Error(`Không có kịch bản ${NAME}`);
if (NAME === 'rps500' && E.ALLOW_HIGH_LOAD !== '1') throw new Error('rps500 cần ALLOW_HIGH_LOAD=1 và sự đồng ý của chủ tài khoản AWS');
if (NAME === 'region-failure' && E.TARGET !== 'entry' && !local) throw new Error('region-failure chỉ dùng với TARGET=entry');

const strict = NAME !== 'upstream-timeout' && NAME !== 'region-failure';
export const options = {
  scenarios: { [NAME]: SCENARIOS[NAME] },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: strict ? {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '10s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '10s' }],
  } : {},
};

export default function () {
  const res = http.request(E.PERF_METHOD || 'GET', url, E.PERF_BODY || null,
    { headers, timeout: NAME === 'upstream-timeout' ? '35s' : '10s' });
  check(res, { 'status 2xx/3xx': r => r.status >= 200 && r.status < 400 });
  if (NAME === 'baseline') sleep(1);
}
