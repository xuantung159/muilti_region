// mrapi-geo-probe: chạy ở us-east-1 (Mỹ), gửi request THẬT từ Mỹ tới api.multi-region.io.vn/health
// qua DNS thật, trả về Region phục vụ. Không đọc input của người gọi, không cần quyền AWS nào ngoài log.
// Được gọi qua Lambda Function URL (auth NONE); chỉ trả dữ liệu vô hại: Region probe, IP public của chính
// Lambda này, HTTP status, X-Served-Region và thời gian.
const TARGET = process.env.TARGET_URL || "https://api.multi-region.io.vn/health";

export async function probe(fetchImpl = fetch) {
  let sourceIp = null;
  try {
    const ipRes = await fetchImpl("https://checkip.amazonaws.com", { signal: AbortSignal.timeout(2000) });
    const ip = (await ipRes.text()).trim();
    sourceIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
  } catch { /* IP chỉ để hiển thị. */ }

  const started = performance.now();
  const res = await fetchImpl(TARGET, { headers: { "Cache-Control": "no-cache", "User-Agent": "mrapi-geo-probe" }, signal: AbortSignal.timeout(4000) });
  await res.arrayBuffer();
  return {
    probeRegion: process.env.AWS_REGION ?? null,
    sourceIp,
    status: res.status,
    servedRegion: res.headers.get("x-served-region"),
    latencyMs: Math.round(performance.now() - started),
    testedAt: new Date().toISOString(),
  };
}

export const handler = async () => {
  try {
    return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(await probe()) };
  } catch (err) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: err.name ?? "Error" }) };
  }
};
