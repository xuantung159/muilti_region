// Reuse the portal session validator; no additional IAM grants or duplicated session cache.
const PORTAL_URLS = {
  'ap-southeast-1': 'https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo',
  'ap-northeast-1': 'https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo',
};
// Chỉ tài khoản admin của portal mới được xem số liệu hạ tầng dùng chung (Lambda, API Gateway toàn stage).
// Lỗi hay hết hạn đều coi là không phải admin (fail closed).
export async function isReportAdmin(event, fetchFn = fetch) {
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const authorization = headers.authorization ?? '';
  const base = process.env.MONITORING_PORTAL_URL ?? PORTAL_URLS[process.env.AWS_REGION];
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization) || !base) return false;
  try {
    const response = await fetchFn(`${base.replace(/\/+$/, '')}/api/me`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok) return false;
    return (await response.json())?.role === 'admin';
  } catch {
    return false;
  }
}

export async function authorizeReport(event, fetchFn = fetch) {
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const authorization = headers.authorization ?? '';
  const denied = { status: 401, code: 'LOGIN_REQUIRED', error: 'Cần đăng nhập để xem báo cáo.' };
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) return denied;
  const base = process.env.MONITORING_PORTAL_URL ?? PORTAL_URLS[process.env.AWS_REGION];
  if (!base) return { status: 503, code: 'AUTH_UNAVAILABLE', error: 'Chưa cấu hình xác thực báo cáo.' };
  try {
    const response = await fetchFn(`${base.replace(/\/+$/, '')}/api/keys`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (response.status === 401) return denied;
    if (!response.ok) throw new Error('portal_auth_failed');
    const result = await response.json();
    if (!Array.isArray(result.keys)) throw new Error('portal_auth_invalid');
    if (result.keys.some(key => key.status === 'active')) return null;
    return { status: 403, code: 'API_KEY_REQUIRED', error: 'Cần đăng ký API key còn hoạt động để xem báo cáo.' };
  } catch {
    return { status: 503, code: 'AUTH_UNAVAILABLE', error: 'Không xác minh được quyền xem báo cáo. Vui lòng thử lại.' };
  }
}
