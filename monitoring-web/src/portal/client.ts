export class PortalError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export const portalBase = (import.meta.env.VITE_PORTAL_API_URL ?? '').replace(/\/+$/, '');
export const TOKEN_KEY = 'mrapi.portal.token';
export function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function saveToken(token: string | null) {
  try { if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* Session remains in memory. */ }
}


export async function portalCall<T>(path: string, token: string | null, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${portalBase}/api/${path}`, {
      method, signal: signal ?? AbortSignal.timeout(15000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PortalError('Không kết nối được tới máy chủ doanh nghiệp.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new PortalError('Chưa kết nối API doanh nghiệp. Cấu hình VITE_PORTAL_API_URL hoặc PORTAL_API_TARGET rồi khởi động lại frontend.');
  }
  const data = await response.json();
  if (!response.ok) throw new PortalError(data.error || `Lỗi HTTP ${response.status}`, response.status);
  return data as T;
}

