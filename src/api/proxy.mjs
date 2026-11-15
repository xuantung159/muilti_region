// Proxy: chuyển request /proxy/{apiId}/{đường dẫn} tới backend HTTPS doanh nghiệp đã đăng ký,
// trả lại kết quả và ghi một dòng telemetry cho mỗi request.
//
// Authorizer đã kiểm tra key và scope trước khi request tới đây. Proxy chỉ tin tenant_id/key_id
// từ authorizer, tự đọc cấu hình API theo tenant đó nên không gọi được API của doanh nghiệp khác.
import { randomUUID } from 'node:crypto';
import { Agent, request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { errorCauseOf, errorClassOf } from '../shared/errors.mjs';
import { API_ID_PATTERN, CONTROL_TABLE, REGION, TELEMETRY_TABLE, apiRef, db, json } from '../shared/lib.mjs';
import { UNKNOWN_COUNTRY, countryOf, routingMetric } from './geo.mjs';
import { safeLookup } from './target.mjs';

export const MAX_REQUEST_BYTES = 1024 * 1024;
// Lambda trả tối đa 6 MB; body nhị phân base64 tăng khoảng 4/3 nên giữ dưới 4 MB.
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RETENTION_DAYS = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 30);
// Phiên bản schema item telemetry (docs/performance/LATENCY_ANALYSIS.md mục 5.1). Item cũ không có trường này = 1.
export const TELEMETRY_SCHEMA_VERSION = 2;
// Hạn chót cho PutItem telemetry. Bình thường PutItem trong cùng Region chỉ mất vài ms; hạn này chỉ chặn trường hợp
// DynamoDB chậm/throttle khiến SDK retry kèm backoff làm client chờ thêm hàng giây. Hết hạn: response vẫn trả,
// log TELEMETRY_WRITE_FAILED + PROXY_TELEMETRY_WRITE ok=false; dòng log PROXY_REQUEST vẫn giữ đủ dữ liệu của request.
export const TELEMETRY_WRITE_TIMEOUT_MS = Math.max(100, Number(process.env.TELEMETRY_WRITE_TIMEOUT_MS) || 2000);
// Cache cấu hình API trong bộ nhớ container (ms). Mặc định 0 = tắt: đọc ConsistentRead mỗi request như trước.
// Bật (vd. 5000) thì sửa/tắt/xóa API có thể chậm hiệu lực tới chừng ấy ms ở container đang ấm.
// Chỉ cache kết quả tìm thấy; "không tìm thấy" không cache để API vừa tạo (hoặc vừa replicate) dùng được ngay.
const API_CONFIG_CACHE_MS = Math.max(0, Number(process.env.API_CONFIG_CACHE_MS) || 0);
const API_CONFIG_CACHE_MAX = 256;

// Header không chuyển tiếp: hop-by-hop, key gateway, phiên portal, header nội bộ AWS/CloudFront.
const DROP_REQUEST = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|host|content-length|accept-encoding|x-api-key|authorization|cookie|via|forwarded|x-forwarded-.*|x-amz.*|x-amzn-.*|cloudfront-.*)$/;
const DROP_RESPONSE = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-length|content-encoding)$/;
const TEXT_TYPE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|problem\+json)|[^;]*\+(json|xml)\b)/i;

// Cho phép test thay phần gọi mạng.
export const transport = { request: httpsRequest };

// Giữ kết nối TCP/TLS tới backend giữa các lần gọi khi Lambda còn ấm, bỏ được một lần bắt tay
// (vài chục tới vài trăm ms với backend ở xa) cho mỗi request. `safeLookup` vẫn chạy mỗi khi mở kết nối mới;
// kết nối được dùng lại là kết nối đã qua kiểm tra SSRF. LIFO để ưu tiên socket vừa dùng, ít khả năng đã bị đóng.
export const upstreamAgent = new Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, scheduling: 'lifo' });
// Chỉ method idempotent mới dùng lại kết nối, vì chỉ chúng được phép gửi lại khi socket cũ hỏng.
// POST/PATCH cố ý mở kết nối mới: socket cũ hỏng giữa chừng thì không được gửi lại (không idempotent) → sẽ thành 502.
const REUSABLE = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
// Lỗi kiểu "backend đã đóng kết nối nhàn rỗi trong lúc Lambda bị đóng băng".
const STALE_SOCKET = new Set(['ECONNRESET', 'EPIPE']);

const MESSAGES = {
  API_NOT_FOUND: 'Không tìm thấy API đích',
  API_DISABLED: 'API đích đang tắt',
  TARGET_BLOCKED: 'Địa chỉ backend không được phép',
  PAYLOAD_TOO_LARGE: `Body request vượt quá ${MAX_REQUEST_BYTES} byte`,
  BAD_PATH: 'Đường dẫn không hợp lệ',
  UPSTREAM_TIMEOUT: 'Backend không phản hồi kịp thời gian chờ',
  UPSTREAM_UNREACHABLE: 'Không kết nối được tới backend',
  UPSTREAM_TOO_LARGE: 'Phản hồi của backend quá lớn',
  GATEWAY_INTERNAL: 'Lỗi gateway',
};
const STATUS = {
  API_NOT_FOUND: 404, API_DISABLED: 403, TARGET_BLOCKED: 403, PAYLOAD_TOO_LARGE: 413, BAD_PATH: 400,
  UPSTREAM_TIMEOUT: 504, UPSTREAM_UNREACHABLE: 502, UPSTREAM_TOO_LARGE: 502, GATEWAY_INTERNAL: 500,
};

// Lỗi do gateway sinh ra có header X-Mrapi-Source: gateway để phân biệt với phản hồi của backend.
const gatewayError = (errorType, requestId) => {
  const response = json(STATUS[errorType], { error: MESSAGES[errorType], code: errorType, requestId });
  response.headers['X-Mrapi-Source'] = 'gateway';
  response.headers['X-Request-Id'] = requestId;
  return response;
};

const safeDecode = segment => {
  try { return decodeURIComponent(segment); } catch { return null; }
};

// Ghép baseUrl + đường dẫn con + query. Mỗi đoạn được mã hóa lại; "." và ".." bị từ chối
// để client không thoát ra ngoài đường dẫn gốc của backend (vd. /v1/../admin).
export function targetUrl(baseUrl, segments, event) {
  const decoded = segments.map(safeDecode);
  if (decoded.some(part => part === null || part === '.' || part === '..')) return null;
  const url = new URL(baseUrl);
  const rest = decoded.map(encodeURIComponent).join('/');
  const trailing = rest && (event.path ?? '').endsWith('/') ? '/' : '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${rest ? `/${rest}` : ''}${trailing}` || '/';
  const query = new URLSearchParams();
  const multi = event.multiValueQueryStringParameters;
  for (const [name, values] of Object.entries(multi ?? {})) for (const value of values ?? []) query.append(name, value);
  if (!multi) for (const [name, value] of Object.entries(event.queryStringParameters ?? {})) query.append(name, value ?? '');
  url.search = query.toString();
  return url;
}

function forwardHeaders(event, requestId) {
  const headers = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    const lower = name.toLowerCase();
    if (!DROP_REQUEST.test(lower) && value !== undefined && value !== null) headers[lower] = value;
  }
  // Nhận body nguyên bản để không phải giải nén; request ID giúp đối chiếu log hai bên.
  return { ...headers, 'accept-encoding': 'identity', 'x-request-id': requestId };
}

const elapsed = since => Math.max(0, Math.round(performance.now() - since));

// Gửi request với một hạn chót cho toàn bộ quá trình: DNS, kết nối, TLS, chờ và đọc phản hồi.
// Kết quả (và err.timing khi lỗi) có `timing`, đo bằng đồng hồ đơn điệu performance.now(), đơn vị ms:
//   upstreamMs        từ trước lần gửi đầu tới khi xong/lỗi/timeout (gồm cả lần gửi lại)
//   upstreamConnectMs DNS + TCP + TLS của lần gửi cuối, chỉ khi lần đó mở socket mới và đã secureConnect
//   upstreamTtfbMs    từ mốc đầu tới khi nhận header phản hồi
//   upstreamStatus    status thật của backend (khi đã nhận header)
//   upstreamReused / upstreamRetried  socket của lần gửi cuối lấy từ pool / đã gửi lại do socket cũ hỏng
function send(url, method, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const timing = { upstreamReused: false, upstreamRetried: false };
    let settled = false;
    let req;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      timing.upstreamMs = elapsed(t0);
      timing.upstreamReused = Boolean(req?.reusedSocket);
      value.timing = timing;
      fn(value);
    };
    const fail = (code, cause) => finish(reject, Object.assign(new Error(code), { code, cause }));
    const attempt = reuse => {
      let responded = false;
      const attemptStart = performance.now();
      delete timing.upstreamConnectMs;
      const current = req = transport.request(url, {
        method, headers: { ...headers, 'content-length': String(body.length) }, lookup: safeLookup,
        agent: reuse ? upstreamAgent : false,
      }, res => {
        responded = true;
        timing.upstreamTtfbMs = elapsed(t0);
        if (Number.isInteger(res.statusCode)) timing.upstreamStatus = res.statusCode;
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { current.destroy(); return fail('UPSTREAM_TOO_LARGE'); }
          chunks.push(chunk);
        });
        res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', err => fail('UPSTREAM_UNREACHABLE', err));
      });
      // Socket mới phát 'secureConnect' sau DNS + TCP + TLS; socket lấy lại từ pool thì không (đã kết nối từ trước),
      // nên khi dùng lại socket không có số đo connect.
      current.on('socket', socket => {
        socket.once?.('secureConnect', () => {
          if (req === current && !settled) timing.upstreamConnectMs = elapsed(attemptStart);
        });
      });
      current.on('error', err => {
        // Socket lấy từ pool đã bị backend đóng trước khi có phản hồi: gửi lại một lần bằng kết nối mới,
        // vẫn trong cùng hạn chót. Chỉ method idempotent đi qua pool (reuse = true) nên chỉ chúng được gửi lại.
        if (!settled && reuse && !responded && current.reusedSocket && STALE_SOCKET.has(err.code)) {
          timing.upstreamRetried = true;
          return attempt(false);
        }
        fail(err.code === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED' : 'UPSTREAM_UNREACHABLE', err);
      });
      current.end(body);
    };
    const timer = setTimeout(() => { req?.destroy(); fail('UPSTREAM_TIMEOUT'); }, timeoutMs);
    attempt(REUSABLE.has(method));
  });
}

function upstreamResponse(result, requestId) {
  const headers = { 'X-Mrapi-Source': 'upstream', 'X-Request-Id': requestId, 'X-Served-Region': REGION };
  const multiValueHeaders = {};
  for (const [name, value] of Object.entries(result.headers)) {
    if (DROP_RESPONSE.test(name)) continue;
    if (Array.isArray(value)) multiValueHeaders[name] = value;
    else headers[name] = value;
  }
  const isText = !result.body.length || TEXT_TYPE.test(result.headers['content-type'] ?? '');
  return {
    statusCode: result.status,
    headers,
    ...(Object.keys(multiValueHeaders).length ? { multiValueHeaders } : {}),
    body: isText ? result.body.toString('utf8') : result.body.toString('base64'),
    isBase64Encoded: !isText,
  };
}

// Thuộc tính đo thêm (schemaVersion 2). Thuộc tính không có mặt bị bỏ hẳn: DocumentClient không nhận undefined
// và hợp đồng không cho ghi null.
function measurements(record, latencyMs) {
  const { timing } = record;
  const errorClass = errorClassOf(record);
  const fields = { schemaVersion: TELEMETRY_SCHEMA_VERSION, coldStart: Boolean(record.coldStart) };
  if (errorClass) fields.errorClass = errorClass;
  if (errorClass === 'connection_error' || errorClass === 'timeout') {
    const cause = errorCauseOf(record.cause);
    if (cause) fields.errorCause = cause;
  }
  if (timing && Number.isFinite(timing.upstreamMs)) {
    fields.upstreamMs = timing.upstreamMs;
    fields.gatewayMs = Math.max(0, latencyMs - timing.upstreamMs);
    if (Number.isFinite(timing.upstreamConnectMs)) fields.upstreamConnectMs = timing.upstreamConnectMs;
    if (Number.isFinite(timing.upstreamTtfbMs)) fields.upstreamTtfbMs = timing.upstreamTtfbMs;
    if (Number.isInteger(timing.upstreamStatus)) fields.upstreamStatus = timing.upstreamStatus;
    fields.upstreamReused = Boolean(timing.upstreamReused);
    fields.upstreamRetried = Boolean(timing.upstreamRetried);
  } else {
    fields.gatewayMs = latencyMs;
  }
  return fields;
}

// PutItem có hạn chót. Hết hạn thì hủy request SDK; promise của SDK vẫn được bắt lỗi để không thành unhandled rejection.
async function putTelemetry(item) {
  const controller = new AbortController();
  let timer;
  const sending = db.send(new PutCommand({ TableName: TELEMETRY_TABLE, Item: item }), { abortSignal: controller.signal });
  sending.catch(() => {});
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('telemetry write timeout'), { name: 'TelemetryWriteTimeout' }));
    }, TELEMETRY_WRITE_TIMEOUT_MS);
  });
  try {
    await Promise.race([sending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Một dòng mỗi request theo schema infra/dynamodb/ap-southeast-1/mrapi-telemetry.md.
// Không ghi key, query string, header, body hay IP. Ghi lỗi không làm hỏng response cho client.
async function recordTelemetry(record) {
  const timestamp = new Date(record.startedAt).toISOString();
  // latencyMs giữ định nghĩa cũ: từ đầu proxy() tới trước PutItem; đo bằng đồng hồ đơn điệu.
  const latencyMs = elapsed(record.t0);
  const entry = {
    requestId: record.requestId, tenantId: record.tenantId, apiId: record.apiId, keyId: record.keyId,
    method: record.method, path: record.path, status: record.status, ...(record.errorType ? { errorType: record.errorType } : {}),
    latencyMs, region: REGION, country: record.country ?? UNKNOWN_COUNTRY, timestamp,
    ...measurements(record, latencyMs),
  };
  console.log(JSON.stringify({ event: 'PROXY_REQUEST', ...entry }));
  console.log(JSON.stringify(routingMetric(entry.country, REGION, record.startedAt)));
  const SK = `${timestamp}#${record.requestId}`;
  const item = {
    PK: `TENANT#${record.tenantId}`, SK, ...entry,
    expiresAt: Math.floor(record.startedAt / 1000) + RETENTION_DAYS * 86400,
    // Chỉ request lỗi có GSI1 để truy vấn nhanh "các lỗi gần đây" của một doanh nghiệp.
    ...(record.errorType ? { GSI1PK: `TENANT#${record.tenantId}#ERR`, GSI1SK: SK } : {}),
  };
  const writeStart = performance.now();
  let ok = true;
  try {
    await putTelemetry(item);
  } catch (err) {
    ok = false;
    // Dòng log này là nguồn cho metric filter/alarm khi telemetry bị mất.
    console.error(JSON.stringify({ event: 'TELEMETRY_WRITE_FAILED', requestId: record.requestId, error: err.name }));
  }
  console.log(JSON.stringify({ event: 'PROXY_TELEMETRY_WRITE', requestId: record.requestId, writeMs: elapsed(writeStart), ok }));
}

// Request đầu tiên mà container xử lý (kể cả /health, xem api/index.mjs) lấy cờ cold start.
let coldStart = true;
export function consumeColdStart() {
  const value = coldStart;
  coldStart = false;
  return value;
}

const apiConfigCache = new Map();
async function loadApi(tenantId, apiId) {
  const cacheKey = `${tenantId}/${apiId}`;
  if (API_CONFIG_CACHE_MS > 0) {
    const hit = apiConfigCache.get(cacheKey);
    if (hit && hit.expiresAt > performance.now()) return structuredClone(hit.api);
    apiConfigCache.delete(cacheKey);
  }
  const { Item: api } = await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: apiRef(tenantId, apiId), ConsistentRead: true }));
  if (api && API_CONFIG_CACHE_MS > 0) {
    if (apiConfigCache.size >= API_CONFIG_CACHE_MAX) apiConfigCache.delete(apiConfigCache.keys().next().value);
    apiConfigCache.set(cacheKey, { api: structuredClone(api), expiresAt: performance.now() + API_CONFIG_CACHE_MS });
  }
  return api;
}

export async function proxy(event, [apiId, ...segments], options = {}) {
  const t0 = performance.now();
  const startedAt = Date.now();
  const isColdStart = typeof options.coldStart === 'boolean' ? options.coldStart : consumeColdStart();
  // Correlation ID: requestId của API Gateway (= $context.requestId trong access log), gửi sang backend qua
  // x-request-id và trả lại client qua X-Request-Id.
  const requestId = event.requestContext?.requestId ?? randomUUID();
  const auth = event.requestContext?.authorizer ?? {};
  // Route proxy phải gắn authorizer; thiếu context nghĩa là cấu hình API Gateway sai, không chuyển tiếp.
  // Không có tenant nên không ghi được item telemetry (PK theo tenant); log đủ trường để đếm bằng Logs Insights.
  if (!auth.tenant_id || !auth.key_id) {
    console.error(JSON.stringify({
      event: 'PROXY_NO_AUTHORIZER', requestId, status: 500, errorType: 'GATEWAY_INTERNAL', errorClass: 'gateway',
      latencyMs: elapsed(t0), region: REGION, coldStart: isColdStart, schemaVersion: TELEMETRY_SCHEMA_VERSION,
    }));
    return gatewayError('GATEWAY_INTERNAL', requestId);
  }
  const record = {
    requestId, startedAt, t0, coldStart: isColdStart, tenantId: auth.tenant_id, keyId: auth.key_id, apiId: apiId ?? '',
    method: event.httpMethod, path: `/${segments.join('/')}`,
    // Chỉ giữ mã quốc gia, không ghi IP nguồn.
    country: countryOf(event.requestContext?.identity?.sourceIp),
  };
  const done = async (response, errorType, extra = {}) => {
    await recordTelemetry({ ...record, ...extra, status: response.statusCode, errorType });
    return response;
  };
  try {
    if (!API_ID_PATTERN.test(apiId ?? '')) return done(gatewayError('API_NOT_FOUND', requestId), 'API_NOT_FOUND');
    const api = await loadApi(auth.tenant_id, apiId);
    if (!api) return done(gatewayError('API_NOT_FOUND', requestId), 'API_NOT_FOUND');
    if (!api.enabled) return done(gatewayError('API_DISABLED', requestId), 'API_DISABLED');

    const url = targetUrl(api.baseUrl, segments, event);
    if (!url || url.protocol !== 'https:') return done(gatewayError('BAD_PATH', requestId), 'BAD_PATH');
    const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64') : Buffer.from(event.body ?? '', 'utf8');
    if (body.length > MAX_REQUEST_BYTES) return done(gatewayError('PAYLOAD_TOO_LARGE', requestId), 'PAYLOAD_TOO_LARGE');

    const result = await send(url, event.httpMethod, forwardHeaders(event, requestId), body, api.timeoutMs ?? 5000);
    return done(upstreamResponse(result, requestId), result.status >= 500 ? 'UPSTREAM_5XX' : undefined, { timing: result.timing });
  } catch (err) {
    const errorType = STATUS[err.code] ? err.code : 'GATEWAY_INTERNAL';
    if (errorType === 'GATEWAY_INTERNAL') console.error('proxy internal error', err);
    else console.log(JSON.stringify({ event: 'PROXY_UPSTREAM_ERROR', requestId, errorType, cause: err.cause?.code }));
    return done(gatewayError(errorType, requestId), errorType, { timing: err.timing, cause: err.cause });
  }
}
