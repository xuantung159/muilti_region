// Proxy: chuyển request /proxy/{apiId}/{đường dẫn} tới backend HTTPS doanh nghiệp đã đăng ký,
// trả lại kết quả và ghi một dòng telemetry cho mỗi request.
//
// Authorizer đã kiểm tra key và scope trước khi request tới đây. Proxy chỉ tin tenant_id/key_id
// từ authorizer, tự đọc cấu hình API theo tenant đó nên không gọi được API của doanh nghiệp khác.
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { API_ID_PATTERN, CONTROL_TABLE, REGION, TELEMETRY_TABLE, apiRef, db, json } from '../shared/lib.mjs';
import { safeLookup } from './target.mjs';

export const MAX_REQUEST_BYTES = 1024 * 1024;
// Lambda trả tối đa 6 MB; body nhị phân base64 tăng khoảng 4/3 nên giữ dưới 4 MB.
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RETENTION_DAYS = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 30);

// Header không chuyển tiếp: hop-by-hop, key gateway, phiên portal, header nội bộ AWS/CloudFront.
const DROP_REQUEST = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|host|content-length|accept-encoding|x-api-key|authorization|cookie|via|forwarded|x-forwarded-.*|x-amz.*|x-amzn-.*|cloudfront-.*)$/;
const DROP_RESPONSE = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-length|content-encoding)$/;
const TEXT_TYPE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|problem\+json)|[^;]*\+(json|xml)\b)/i;

// Cho phép test thay phần gọi mạng.
export const transport = { request: httpsRequest };

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

// Gửi request với một hạn chót cho toàn bộ quá trình: DNS, kết nối, TLS, chờ và đọc phản hồi.
function send(url, method, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const fail = (code, cause) => finish(reject, Object.assign(new Error(code), { code, cause }));
    const req = transport.request(url, {
      method, headers: { ...headers, 'content-length': String(body.length) }, lookup: safeLookup, agent: false,
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { req.destroy(); return fail('UPSTREAM_TOO_LARGE'); }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', err => fail('UPSTREAM_UNREACHABLE', err));
    });
    const timer = setTimeout(() => { req.destroy(); fail('UPSTREAM_TIMEOUT'); }, timeoutMs);
    req.on('error', err => fail(err.code === 'TARGET_BLOCKED' ? 'TARGET_BLOCKED' : 'UPSTREAM_UNREACHABLE', err));
    req.end(body);
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

// Một dòng mỗi request theo schema infra/dynamodb/ap-southeast-1/mrapi-telemetry.md.
// Không ghi key, query string, header hay body. Ghi lỗi không làm hỏng response cho client.
async function recordTelemetry(record) {
  const timestamp = new Date(record.startedAt).toISOString();
  const entry = {
    requestId: record.requestId, tenantId: record.tenantId, apiId: record.apiId, keyId: record.keyId,
    method: record.method, path: record.path, status: record.status, ...(record.errorType ? { errorType: record.errorType } : {}),
    latencyMs: Date.now() - record.startedAt, region: REGION, timestamp,
  };
  console.log(JSON.stringify({ event: 'PROXY_REQUEST', ...entry }));
  const SK = `${timestamp}#${record.requestId}`;
  const item = {
    PK: `TENANT#${record.tenantId}`, SK, ...entry,
    expiresAt: Math.floor(record.startedAt / 1000) + RETENTION_DAYS * 86400,
    // Chỉ request lỗi có GSI1 để truy vấn nhanh "các lỗi gần đây" của một doanh nghiệp.
    ...(record.errorType ? { GSI1PK: `TENANT#${record.tenantId}#ERR`, GSI1SK: SK } : {}),
  };
  try {
    await db.send(new PutCommand({ TableName: TELEMETRY_TABLE, Item: item }));
  } catch (err) {
    // Dòng log này là nguồn cho metric filter/alarm khi telemetry bị mất.
    console.error(JSON.stringify({ event: 'TELEMETRY_WRITE_FAILED', requestId: record.requestId, error: err.name }));
  }
}

export async function proxy(event, [apiId, ...segments]) {
  const startedAt = Date.now();
  const requestId = event.requestContext?.requestId ?? randomUUID();
  const auth = event.requestContext?.authorizer ?? {};
  // Route proxy phải gắn authorizer; thiếu context nghĩa là cấu hình API Gateway sai, không chuyển tiếp.
  if (!auth.tenant_id || !auth.key_id) {
    console.error(JSON.stringify({ event: 'PROXY_NO_AUTHORIZER', requestId }));
    return gatewayError('GATEWAY_INTERNAL', requestId);
  }
  const record = {
    requestId, startedAt, tenantId: auth.tenant_id, keyId: auth.key_id, apiId: apiId ?? '',
    method: event.httpMethod, path: `/${segments.join('/')}`,
  };
  const done = async (response, errorType) => {
    await recordTelemetry({ ...record, status: response.statusCode, errorType });
    return response;
  };
  try {
    if (!API_ID_PATTERN.test(apiId ?? '')) return done(gatewayError('API_NOT_FOUND', requestId), 'API_NOT_FOUND');
    const { Item: api } = await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: apiRef(auth.tenant_id, apiId), ConsistentRead: true }));
    if (!api) return done(gatewayError('API_NOT_FOUND', requestId), 'API_NOT_FOUND');
    if (!api.enabled) return done(gatewayError('API_DISABLED', requestId), 'API_DISABLED');

    const url = targetUrl(api.baseUrl, segments, event);
    if (!url || url.protocol !== 'https:') return done(gatewayError('BAD_PATH', requestId), 'BAD_PATH');
    const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64') : Buffer.from(event.body ?? '', 'utf8');
    if (body.length > MAX_REQUEST_BYTES) return done(gatewayError('PAYLOAD_TOO_LARGE', requestId), 'PAYLOAD_TOO_LARGE');

    const result = await send(url, event.httpMethod, forwardHeaders(event, requestId), body, api.timeoutMs ?? 5000);
    return done(upstreamResponse(result, requestId), result.status >= 500 ? 'UPSTREAM_5XX' : undefined);
  } catch (err) {
    const errorType = STATUS[err.code] ? err.code : 'GATEWAY_INTERNAL';
    if (errorType === 'GATEWAY_INTERNAL') console.error('proxy internal error', err);
    else console.log(JSON.stringify({ event: 'PROXY_UPSTREAM_ERROR', requestId, errorType, cause: err.cause?.code }));
    return done(gatewayError(errorType, requestId), errorType);
  }
}
