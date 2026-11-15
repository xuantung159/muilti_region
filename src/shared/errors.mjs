// Phân loại lỗi dùng chung cho proxy (lúc ghi telemetry) và báo cáo (lúc đọc, kể cả item cũ chưa có errorClass).
// Hợp đồng: docs/performance/LATENCY_ANALYSIS.md mục 5.1.
export const ERROR_CLASSES = ['client_4xx', 'gateway', 'upstream_4xx', 'upstream_5xx', 'timeout', 'connection_error'];

// Lỗi do request/cấu hình của client, gateway từ chối trước khi gọi backend.
const CLIENT_TYPES = new Set(['API_NOT_FOUND', 'API_DISABLED', 'BAD_PATH', 'PAYLOAD_TOO_LARGE', 'TARGET_BLOCKED']);
const FIVE_XX_CLASSES = new Set(['gateway', 'upstream_5xx', 'timeout', 'connection_error']);

function classify(status, errorType) {
  if (CLIENT_TYPES.has(errorType)) return 'client_4xx';
  if (errorType === 'GATEWAY_INTERNAL') return 'gateway';
  if (errorType === 'UPSTREAM_TIMEOUT') return 'timeout';
  if (errorType === 'UPSTREAM_UNREACHABLE') return 'connection_error';
  if (errorType === 'UPSTREAM_5XX' || errorType === 'UPSTREAM_TOO_LARGE') return 'upstream_5xx';
  if (!errorType) return status >= 500 ? 'upstream_5xx' : 'upstream_4xx';
  return status >= 500 ? 'gateway' : 'client_4xx';
}

// Nhóm 4xx/5xx mà một errorClass thuộc về; dùng để giữ bất biến
// error4xx = client_4xx + upstream_4xx, error5xx = gateway + upstream_5xx + timeout + connection_error.
export const isFiveXxClass = errorClass => FIVE_XX_CLASSES.has(errorClass);

// Trả null khi thành công (status < 400) hoặc status không phải số.
// Tổ hợp không thể xảy ra trong dữ liệu thật (vd. status 500 + API_NOT_FOUND) được kéo về nhóm khớp status
// để bất biến 4xx/5xx luôn đúng: 5xx → 'gateway', 4xx → 'client_4xx'.
export function errorClassOf({ status, errorType } = {}) {
  if (!Number.isFinite(status) || status < 400) return null;
  const type = typeof errorType === 'string' && errorType ? errorType : undefined;
  const errorClass = classify(status, type);
  if (isFiveXxClass(errorClass) !== status >= 500) return status >= 500 ? 'gateway' : 'client_4xx';
  return errorClass;
}

// errorClass đã lưu trong item (schemaVersion 2) nếu hợp lệ và khớp status; không thì tính lại từ status + errorType.
export function recordErrorClass(record) {
  const computed = errorClassOf(record);
  const stored = record?.errorClass;
  if (computed && ERROR_CLASSES.includes(stored) && isFiveXxClass(stored) === isFiveXxClass(computed)) return stored;
  return computed;
}

// Mã nguyên nhân lỗi mạng (err.cause.code) đã lọc: chỉ chữ hoa, số, gạch dưới, tối đa 64 ký tự.
// Ví dụ ECONNREFUSED, ENOTFOUND, ECONNRESET, UND_ERR_SOCKET, ERR_TLS_CERT_ALTNAME_INVALID, CERT_HAS_EXPIRED.
export const CAUSE_PATTERN = /^[A-Z0-9_]{1,64}$/;
export function errorCauseOf(cause) {
  const code = cause?.code;
  if (code === undefined || code === null || code === '') return undefined;
  return typeof code === 'string' && CAUSE_PATTERN.test(code) ? code : 'OTHER';
}
