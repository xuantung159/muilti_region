// Node.js 22+, run: node --env-file=.env main.mjs
const { MRAPI_GATEWAY_URL, MRAPI_API_ID, MRAPI_API_KEY } = process.env;
try {
  const base = new URL(MRAPI_GATEWAY_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
      !/^[a-zA-Z0-9_-]+$/.test(MRAPI_API_ID ?? '') || !MRAPI_API_KEY?.startsWith('mrk_')) {
    throw new Error('Kiểm tra 3 biến MRAPI_ trong .env; dùng API ID và key thật từ portal.');
  }
  const start = performance.now();
  const response = await fetch(`${base.href.replace(/\/+$/, '')}/proxy/${MRAPI_API_ID}/todos/1`, {
    headers: { 'x-api-key': MRAPI_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  while (size < 65536) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.subarray(0, 65536 - size)); size += value.length;
  }
  await reader.cancel();
  console.log(`HTTP ${response.status} | ${Math.round(performance.now() - start)} ms | region: ${response.headers.get('x-served-region') ?? ''}`);
  console.log(Buffer.concat(chunks).toString('utf8').replaceAll(MRAPI_API_KEY, '[API KEY ĐÃ ẨN]'));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error('Lỗi: kiểm tra .env, URL gateway, kết nối mạng và TLS.');
  process.exitCode = 1;
}
