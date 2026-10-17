import type { portalCall } from './client';

// Each demo entry creates an isolated in-memory workspace. Never calls fetch/storage.
export function createDemoClient(): typeof portalCall {
  let next = 1;
  const apis = [{ apiId: 'demo-orders', name: 'API đơn hàng mẫu', baseUrl: 'https://backend.company.example/v1', timeoutMs: 5000, enabled: true }];
  const keys = [{ keyId: 'demo-key', name: 'Ứng dụng bán hàng mẫu', status: 'active', createdAt: new Date().toISOString() }];
  const secrets = new Map([['DEMO_ONLY_SAMPLE_KEY', 'demo-key']]);
  let requests = 0;
  return async <T>(path: string, _token: string | null, method = 'GET', body?: unknown): Promise<T> => {
    const data = body as Record<string, unknown> | undefined;
    let result: unknown;
    const [resource, id] = path.split('?')[0].split('/');
    if (resource === 'me') result = { orgName: 'Doanh nghiệp mẫu · Demo', email: 'demo@company.example', tenantId: 'demo-tenant' };
    else if (resource === 'apis') {
      if (method === 'POST' || (method === 'PATCH' && data?.baseUrl !== undefined)) {
        const url = new URL(String(data?.baseUrl));
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('API demo yêu cầu URL HTTPS không chứa credentials');
        const timeout = Number(data?.timeoutMs);
        if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 10000) throw new Error('Timeout từ 1000 đến 10000 ms');
      }
      if (method === 'POST') {
        const api = { apiId: `demo-api-${next++}`, name: String(data?.name), baseUrl: String(data?.baseUrl), timeoutMs: Number(data?.timeoutMs), enabled: true };
        apis.push(api); result = { api };
      } else if (method === 'PATCH') {
        const api = apis.find(item => item.apiId === id);
        if (!api) throw new Error('Không tìm thấy API demo');
        Object.assign(api, data); result = { api };
      } else result = { apis };
    } else if (resource === 'keys') {
      if (method === 'POST') {
        const key = { keyId: `demo-key-${next++}`, name: String(data?.name), status: 'active', createdAt: new Date().toISOString() };
        const apiKey = `DEMO_ONLY_${key.keyId}_NOT_A_REAL_KEY`;
        keys.push(key); secrets.set(apiKey, key.keyId); result = { key, apiKey };
      } else if (method === 'DELETE') {
        const key = keys.find(item => item.keyId === id);
        if (key) key.status = 'revoked'; result = {};
      } else result = { keys };
    } else if (resource === 'demo' && id === 'request') {
      const api = apis.find(item => item.apiId === data?.apiId);
      const keyId = secrets.get(String(data?.apiKey ?? ''));
      const key = keys.find(item => item.keyId === keyId);
      const status = !key ? 401 : key.status !== 'active' ? 403 : !api ? 404 : !api.enabled ? 403 : data?.upstreamError ? 502 : 200;
      if (status === 200) requests++;
      result = { status, simulated: true, region: 'ap-southeast-1',
        steps: ['Server gửi request đến gateway (mô phỏng)', status === 401 || (status === 403 && key?.status !== 'active') ? 'Gateway từ chối key' : 'Gateway kiểm tra key', status === 200 ? 'Chuyển tiếp tới API đích và nhận JSON mẫu' : 'Dừng request tại lỗi mô phỏng'],
        body: status === 200 ? { orders: [{ id: 'ORDER-DEMO-001', total: 250000, currency: 'VND' }] }
          : { error: status === 401 ? 'Thiếu hoặc sai API key demo' : status === 403 ? 'Key đã thu hồi hoặc API đang tắt' : status === 404 ? 'Không tìm thấy API demo' : 'Backend đích lỗi (mô phỏng)' } };
    } else if (resource === 'status') result = { regions: [{ region: 'ap-southeast-1', status: 'healthy (mô phỏng)' }, { region: 'ap-northeast-1', status: 'healthy (mô phỏng)' }] };
    else if (resource === 'usage') {
      const scale = path.includes('range=1h') ? 1 : path.includes('range=7d') ? 7 : 3;
      const bucketMs = path.includes('range=1h') ? 300000 : path.includes('range=7d') ? 50400000 : 7200000;
      const series = Array.from({ length: 12 }, (_, index) => ['ap-southeast-1', 'ap-northeast-1'].map((servedRegion, regionIndex) => ({
        bucket: new Date(Date.now() - (11 - index) * bucketMs).toISOString().slice(0, 16), servedRegion,
        requests: (12 + index * 2 + regionIndex * 5) * scale, errors: index % 5 === 0 ? scale : 0,
      }))).flat();
      const counts = (rows: typeof series) => ({ requests: rows.reduce((sum, row) => sum + row.requests, 0), errors: rows.reduce((sum, row) => sum + row.errors, 0) });
      series[series.length - 2].requests += requests;
      const totals = counts(series);
      result = { totals: { ...totals, totalMs: totals.requests * 42 }, series,
        byRegion: Object.fromEntries(['ap-southeast-1', 'ap-northeast-1'].map(region => [region, counts(series.filter(row => row.servedRegion === region))])),
        byKey: { 'demo-key': totals } };
    } else throw new Error('Chức năng demo chưa hỗ trợ');
    return structuredClone(result) as T;
  };
}
