// Demo "gửi request từ nước bất kỳ" cho người chấm tự bấm trên web.
//
// Trung thực về phần nào là thật:
//   1. Route 53 TestDNSAnswer: MÔ PHỎNG DNS. Route 53 trả lời đúng như khi resolver (hoặc EDNS Client Subnet)
//      nằm ở nước đã chọn, dùng chính record latency api.multi-region.io.vn đang chạy. Không có gói tin nào
//      thật sự đi từ nước đó.
//   2. Xác định Region của IP trả về: so với IP hiện tại của hai endpoint regional, nếu không khớp (API Gateway
//      xoay vòng nhiều IP) thì tra PTR, AWS đặt tên dạng ec2-…<region>.compute.amazonaws.com.
//   3. Request HTTPS THẬT tới đúng IP đó (SNI + Host = api.multi-region.io.vn, chứng chỉ vẫn được kiểm tra),
//      đọc header X-Served-Region. Request này xuất phát từ Lambda portal (Region đang chạy portal), không
//      phải từ nước đã chọn; nó chứng minh IP Route 53 chọn đúng là Region đó đang phục vụ.
//   4. Với nước có máy thật: Singapore/Nhật (khi portal chạy ở Region đó) gửi request thường qua DNS thật;
//      Mỹ gọi Lambda probe ở us-east-1 (GEO_PROBE_URL) nếu đã cấu hình.
import { promises as dnsPromises } from "node:dns";
import https from "node:https";
import { Route53Client, TestDNSAnswerCommand } from "@aws-sdk/client-route-53";
import { REGION, json, parseBody } from "../shared/lib.mjs";

export const HOSTED_ZONE_ID = "Z03093462BF2L4GV4FGRD";
export const RECORD_NAME = "api.multi-region.io.vn";
export const REGIONAL_ENDPOINTS = {
  "ap-southeast-1": "d-zd1hv50jn0.execute-api.ap-southeast-1.amazonaws.com",
  "ap-northeast-1": "d-csqvriesoh.execute-api.ap-northeast-1.amazonaws.com",
};
const SERVING_REGIONS = Object.keys(REGIONAL_ENDPOINTS);

// IP đại diện: IP public của endpoint ec2.<region>.amazonaws.com (dải IP AWS đặt tại nước đó, phân giải
// 10–11/11/2026). Việt Nam dùng DNS resolver công cộng của VNPT. IP có thể đổi theo thời gian, nhưng vẫn
// thuộc dải của Region đó nên Route 53 vẫn định vị đúng nước.
export const COUNTRIES = [
  { code: "VN", name: "Việt Nam", city: "Hà Nội (DNS VNPT)", ip: "203.162.4.191", nearAws: null },
  { code: "SG", name: "Singapore", city: "Singapore", ip: "47.128.7.101", nearAws: "ap-southeast-1" },
  { code: "JP", name: "Nhật Bản", city: "Tokyo", ip: "52.195.199.44", nearAws: "ap-northeast-1" },
  { code: "KR", name: "Hàn Quốc", city: "Seoul", ip: "43.202.71.241", nearAws: "ap-northeast-2" },
  { code: "HK", name: "Hồng Kông", city: "Hồng Kông", ip: "43.198.167.33", nearAws: "ap-east-1" },
  { code: "ID", name: "Indonesia", city: "Jakarta", ip: "43.218.162.59", nearAws: "ap-southeast-3" },
  { code: "IN", name: "Ấn Độ", city: "Mumbai", ip: "13.200.92.166", nearAws: "ap-south-1" },
  { code: "AU", name: "Úc", city: "Sydney", ip: "3.27.176.127", nearAws: "ap-southeast-2" },
  { code: "AE", name: "UAE", city: "Dubai", ip: "3.28.72.55", nearAws: "me-central-1" },
  { code: "ZA", name: "Nam Phi", city: "Cape Town", ip: "13.246.244.212", nearAws: "af-south-1" },
  { code: "DE", name: "Đức", city: "Frankfurt", ip: "3.78.206.104", nearAws: "eu-central-1" },
  { code: "GB", name: "Anh", city: "London", ip: "13.43.48.202", nearAws: "eu-west-2" },
  { code: "FR", name: "Pháp", city: "Paris", ip: "13.39.221.36", nearAws: "eu-west-3" },
  { code: "SE", name: "Thụy Điển", city: "Stockholm", ip: "16.171.80.137", nearAws: "eu-north-1" },
  { code: "US", name: "Mỹ", city: "Virginia", ip: "98.88.15.13", nearAws: "us-east-1" },
  { code: "CA", name: "Canada", city: "Montréal", ip: "15.156.217.48", nearAws: "ca-central-1" },
  { code: "BR", name: "Brazil", city: "São Paulo", ip: "15.229.200.84", nearAws: "sa-east-1" },
];
const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

// Nước có request thật xuất phát từ đó (không chỉ mô phỏng DNS).
function liveSourceOf(country, region, probeUrl) {
  if (country.nearAws && country.nearAws === region) return "self";
  if (country.code === "US" && probeUrl) return "probe";
  return null;
}

const route53Default = new Route53Client({ region: "us-east-1", maxAttempts: 1 });

// GET https://<ip>/health với SNI và Host là tên miền thật; chứng chỉ vẫn được kiểm tra theo tên miền.
function httpsHealth({ ip, host, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = https.request(
      {
        host: ip ?? host, servername: host, port: 443, path: "/health", method: "GET",
        headers: { Host: host, "User-Agent": "mrapi-geo-demo", "Cache-Control": "no-cache" },
        agent: false, timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({
          status: res.statusCode,
          servedRegion: String(res.headers["x-served-region"] ?? "") || null,
          remoteIp: res.socket?.remoteAddress ?? ip ?? null,
          latencyMs: Math.round(performance.now() - started),
        }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function callProbe(url, timeoutMs, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json();
  const pick = (v, re) => (typeof v === "string" && re.test(v) ? v : null);
  return {
    probeRegion: pick(body.probeRegion, /^[a-z]{2}-[a-z]+-\d$/),
    sourceIp: pick(body.sourceIp, /^\d{1,3}(\.\d{1,3}){3}$/),
    status: Number.isInteger(body.status) ? body.status : null,
    servedRegion: pick(body.servedRegion, /^[a-z]{2}-[a-z]+-\d$/),
    latencyMs: Number.isFinite(body.latencyMs) ? Math.round(body.latencyMs) : null,
  };
}

const regionFromPtr = (name) => /\.([a-z]{2}-[a-z]+-\d)\.compute\.amazonaws\.com\.?$/.exec(name)?.[1] ?? null;

// Cache IP của endpoint regional trong vòng đời Lambda ấm, đủ cho một lượt "chạy tất cả".
let endpointCache = { at: 0, ips: null };
export const resetEndpointCache = () => { endpointCache = { at: 0, ips: null }; };

async function endpointIps(dns) {
  if (endpointCache.ips && Date.now() - endpointCache.at < 60_000) return endpointCache.ips;
  const entries = await Promise.all(SERVING_REGIONS.map(async (region) => {
    try { return [region, await dns.resolve4(REGIONAL_ENDPOINTS[region])]; } catch { return [region, []]; }
  }));
  endpointCache = { at: Date.now(), ips: Object.fromEntries(entries) };
  return endpointCache.ips;
}

async function regionOfIp(ip, dns) {
  const sets = await endpointIps(dns);
  for (const region of SERVING_REGIONS) if (sets[region]?.includes(ip)) return { region, method: "endpoint-ip" };
  try {
    const names = await dns.reverse(ip);
    for (const name of names) {
      const region = regionFromPtr(name);
      if (region) return { region, method: "ptr", ptr: name };
    }
  } catch { /* Không có PTR. */ }
  return { region: null, method: "unknown" };
}

const ms = (start) => Math.round(performance.now() - start);

async function runCountry(country, deps) {
  const { route53, dns, request, fetchImpl, probeUrl, region } = deps;
  const steps = [];
  const result = {
    country: country.code, countryName: country.name, city: country.city,
    resolverIp: country.ip, ecsSubnet: `${country.ip.split(".").slice(0, 3).join(".")}.0/24`,
    dnsAnswer: [], chosenRegion: null, chosenBy: null, servedRegion: null, status: null, latencyMs: null, match: false,
    portalRegion: region ?? null, live: null,
  };

  // Bước 1: Route 53 trả lời như thể resolver ở nước đó.
  let t = performance.now();
  try {
    const answer = await route53.send(new TestDNSAnswerCommand({
      HostedZoneId: HOSTED_ZONE_ID, RecordName: RECORD_NAME, RecordType: "A",
      ResolverIP: country.ip, EDNS0ClientSubnetIP: country.ip, EDNS0ClientSubnetMask: "24",
    }), { abortSignal: AbortSignal.timeout(3000) });
    result.dnsAnswer = (answer.RecordData ?? []).filter((v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v));
    steps.push({ id: "dns", kind: "simulated", ok: result.dnsAnswer.length > 0, ms: ms(t),
      title: "Route 53 TestDNSAnswer (mô phỏng DNS)",
      detail: `Resolver ${country.ip}, EDNS client subnet ${result.ecsSubnet} → ${answer.ResponseCode ?? "?"}: ${result.dnsAnswer.join(", ") || "không có IP"}` });
  } catch (err) {
    steps.push({ id: "dns", kind: "simulated", ok: false, ms: ms(t), title: "Route 53 TestDNSAnswer (mô phỏng DNS)",
      detail: `Không gọi được Route 53: ${err.name ?? "Error"}` });
    return { ...result, steps };
  }
  if (!result.dnsAnswer.length) return { ...result, steps };

  // Bước 2: IP đó thuộc Region nào.
  const ip = result.dnsAnswer[0];
  t = performance.now();
  const located = await regionOfIp(ip, dns);
  result.chosenRegion = located.region;
  result.chosenBy = located.region ? located.method : null;
  steps.push({ id: "locate", kind: "real", ok: Boolean(located.region), ms: ms(t), title: "Xác định Region của IP",
    detail: located.method === "endpoint-ip" ? `${ip} nằm trong IP hiện tại của endpoint ${REGIONAL_ENDPOINTS[located.region]} → ${located.region}`
      : located.method === "ptr" ? `${ip} có PTR ${located.ptr} → ${located.region}`
        : `Không xác định được Region của ${ip} qua DNS; dựa vào request ở bước 3` });

  // Bước 3: request HTTPS thật tới đúng IP Route 53 chọn.
  t = performance.now();
  try {
    const res = await request({ ip, host: RECORD_NAME, timeoutMs: 4000 });
    Object.assign(result, { servedRegion: res.servedRegion, status: res.status, latencyMs: res.latencyMs });
    steps.push({ id: "request", kind: "real", ok: res.status === 200 && Boolean(res.servedRegion), ms: ms(t),
      title: `Request HTTPS thật tới ${ip}`,
      detail: `GET https://${RECORD_NAME}/health (gửi từ Lambda portal ở ${region ?? "?"}) → HTTP ${res.status}, X-Served-Region: ${res.servedRegion ?? "không có"}, ${res.latencyMs} ms` });
  } catch (err) {
    steps.push({ id: "request", kind: "real", ok: false, ms: ms(t), title: `Request HTTPS thật tới ${ip}`,
      detail: `Lỗi: ${err.message === "timeout" ? "quá 4 giây" : err.code ?? err.name ?? "Error"}` });
  }
  // Không định vị được IP độc lập thì lấy theo header, và không tính là "khớp" để tránh tự xác nhận.
  if (!result.chosenRegion && result.servedRegion) Object.assign(result, { chosenRegion: result.servedRegion, chosenBy: "served-header" });
  result.match = result.chosenBy === "served-header" ? null
    : Boolean(result.chosenRegion) && result.chosenRegion === result.servedRegion;

  // Bước 4 (chỉ một số nước): request thật xuất phát từ chính nước đó.
  const source = liveSourceOf(country, region, probeUrl);
  if (source) {
    t = performance.now();
    try {
      if (source === "self") {
        const res = await request({ ip: null, host: RECORD_NAME, timeoutMs: 4000 });
        result.live = { source: "portal-lambda", fromRegion: region, sourceIp: null, ...pickLive(res) };
      } else {
        const res = await callProbe(probeUrl, 5000, fetchImpl);
        result.live = { source: "probe-lambda", fromRegion: res.probeRegion, sourceIp: res.sourceIp, ...pickLive(res) };
      }
      steps.push({ id: "live", kind: "real", ok: result.live.status === 200 && Boolean(result.live.servedRegion), ms: ms(t),
        title: `Request thật từ ${country.name} (DNS thật, không mô phỏng)`,
        detail: `Lambda ở ${result.live.fromRegion ?? "?"}${result.live.sourceIp ? ` (IP ${result.live.sourceIp})` : ""} gọi https://${RECORD_NAME}/health → HTTP ${result.live.status}, X-Served-Region: ${result.live.servedRegion ?? "không có"}, ${result.live.latencyMs} ms` });
    } catch (err) {
      steps.push({ id: "live", kind: "real", ok: false, ms: ms(t), title: `Request thật từ ${country.name} (DNS thật, không mô phỏng)`,
        detail: `Lỗi: ${err.message === "timeout" ? "quá thời gian" : err.code ?? err.name ?? "Error"}` });
    }
  }
  return { ...result, steps };
}

const pickLive = (r) => ({ status: r.status ?? null, servedRegion: r.servedRegion ?? null, latencyMs: r.latencyMs ?? null });

export async function demoGeo(method, session, event, deps = {}) {
  if (!session) return json(401, { error: "Cần đăng nhập để chạy demo" });
  const probeUrl = deps.probeUrl ?? process.env.GEO_PROBE_URL ?? "";
  const region = deps.region ?? REGION;

  if (method === "GET") {
    return json(200, {
      record: RECORD_NAME, hostedZoneId: HOSTED_ZONE_ID, portalRegion: region ?? null,
      servingRegions: SERVING_REGIONS,
      countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, city: c.city, ip: c.ip,
        live: liveSourceOf(c, region, probeUrl) !== null })),
    });
  }
  if (method !== "POST") return json(405, { error: "Phương thức không hỗ trợ" });

  const code = parseBody(event).country;
  const country = typeof code === "string" ? BY_CODE.get(code.toUpperCase()) : undefined;
  if (!country) return json(400, { error: "Nước không có trong danh sách demo" });

  const result = await runCountry(country, {
    route53: deps.route53 ?? route53Default,
    dns: deps.dns ?? dnsPromises,
    request: deps.request ?? httpsHealth,
    fetchImpl: deps.fetch ?? fetch,
    probeUrl, region,
  });
  return json(200, { ...result, testedAt: new Date().toISOString() });
}
