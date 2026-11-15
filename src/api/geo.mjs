// Suy ra quốc gia của client từ IP nguồn, bằng bộ dữ liệu GeoLite2 offline (gói geoip-country,
// dữ liệu của MaxMind, https://www.maxmind.com). Không gọi dịch vụ bên ngoài và không lưu IP:
// chỉ mã quốc gia ISO 3166-1 alpha-2 được ghi vào telemetry và metric.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const UNKNOWN_COUNTRY = 'ZZ';

// Nạp dữ liệu (~8 MB, readFileSync) ngay lúc khởi tạo module, tức pha INIT của Lambda, thay vì trong request
// /proxy đầu tiên của container: phần này không còn bị tính vào latencyMs của request đó.
// Đo trên máy dev (Node 24, x64, SSD): ~20 ms, RSS +12 MB; trên Lambda 256 MB arm64 chưa đo.
// Lỗi nạp không làm hỏng init: countryOf thử nạp lại ở lần gọi sau, vẫn trả 'ZZ' khi lỗi.
let geoip;
try {
  geoip = require('geoip-country');
} catch {
  geoip = undefined;
}

// `lib` chỉ dùng trong test. Lỗi tải dữ liệu hay IP nội bộ đều trả 'ZZ', không làm hỏng request.
export function countryOf(ip, lib) {
  if (typeof ip !== 'string' || !ip) return UNKNOWN_COUNTRY;
  try {
    const db = lib ?? (geoip ??= require('geoip-country'));
    const code = db.lookup(ip)?.country;
    return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : UNKNOWN_COUNTRY;
  } catch {
    return UNKNOWN_COUNTRY;
  }
}

// Một dòng CloudWatch Embedded Metric Format: Lambda tự chuyển thành metric MRAPI/Routing Requests
// theo cặp (Country, ServedRegion), không cần quyền PutMetricData.
export const routingMetric = (country, servedRegion, timestamp = Date.now()) => ({
  _aws: {
    Timestamp: timestamp,
    CloudWatchMetrics: [{ Namespace: 'MRAPI/Routing', Dimensions: [['Country', 'ServedRegion']], Metrics: [{ Name: 'Requests', Unit: 'Count' }] }],
  },
  Country: country,
  ServedRegion: servedRegion,
  Requests: 1,
});
