export type IntegrationApi = { apiId: string; name: string; enabled: boolean };
export type IntegrationKey = { keyId: string; name: string; status: string; apiIds?: string[] };

export function gatewayBase(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Nhập URL gateway HTTPS đã triển khai, gồm stage nếu có.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('URL gateway phải dùng HTTPS, không chứa tài khoản, query hoặc fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

export function requestUrl(gateway: string, apiId: string, path: string) {
  const base = gatewayBase(gateway);
  if (!apiId) throw new Error('Chọn API đích đang bật.');
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#\s]/.test(path)) {
    throw new Error('Đường dẫn phải bắt đầu bằng /, ví dụ /orders?limit=10.');
  }
  // Không cho URL normalization đưa request ra ngoài route proxy của API đã chọn.
  const prefix = `${base}/proxy/${encodeURIComponent(apiId)}/`;
  const url = new URL(prefix + path.slice(1));
  if (!url.href.startsWith(prefix)) throw new Error('Đường dẫn không được thoát khỏi API đã chọn.');
  return url.href;
}

export function envConfig(gateway: string, apiId: string, apiKey: string) {
  if (!apiId || !apiKey.trim() || /\s/.test(apiKey)) throw new Error('Chọn API và nhập API key hợp lệ.');
  return `# Chỉ dùng trên server. Thêm .env vào .gitignore.\nMRAPI_GATEWAY_URL=${gatewayBase(gateway)}\nMRAPI_API_ID=${apiId}\nMRAPI_API_KEY=${apiKey.trim()}\n`;
}

export type GatewayResult = { status: number; durationMs: number; body: string; region: string | null; requestId: string | null; truncated: boolean };

export async function sendGatewayRequest(url: string, apiKey: string, signal: AbortSignal): Promise<GatewayResult> {
  const start = performance.now();
  const response = await fetch(url, {
    method: 'GET', headers: apiKey ? { 'x-api-key': apiKey } : {}, signal,
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let body = '', bytes = 0, truncated = false;
  const limit = 64 * 1024;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { body += decoder.decode(); break; }
        const remaining = limit - bytes;
        body += decoder.decode(chunk.value.subarray(0, remaining), { stream: true });
        bytes += chunk.value.length;
        if (bytes > limit) { truncated = true; await reader.cancel(); body += decoder.decode(); break; }
      }
    } finally { reader.releaseLock(); }
  }
  // Tránh hiển thị lại secret nếu backend phản chiếu header request.
  if (apiKey) body = body.split(apiKey).join('[API KEY ĐÃ ẨN]');
  try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* Hiển thị text thuần qua React. */ }
  return {
    status: response.status, durationMs: Math.round(performance.now() - start), body,
    region: response.headers.get('x-served-region'), requestId: response.headers.get('x-request-id'), truncated,
  };
}
