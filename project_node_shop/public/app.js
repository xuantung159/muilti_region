const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
const when = iso => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const REGION = { 'ap-southeast-1': 'Singapore', 'ap-northeast-1': 'Tokyo' };

let products = [];
let editing = null;
let deleting = null;

let direct = null; // { gatewayBase, regionBases, publicKey } khi trình duyệt gọi thẳng gateway
let singleRegion = null; // Region cố định của chế độ so sánh "một Region"
let healthUrls = null; // { multi, <region>: url } để đo chặng trình duyệt → gateway

// Failover phía trình duyệt, cùng quy tắc với shopClient.js của server:
// - Bình thường gọi api.multi-region.io.vn, Route 53 chọn Region gần người xem.
// - Gateway trả 5xx mà không có X-Served-Region (Lambda proxy của Region đó không chạy) hoặc lỗi mạng với GET:
//   gửi lại ngay sang endpoint của Region kia, rồi ghim Region đó FAILOVER_HOLD_MS trước khi trả lại cho Route 53.
// Trình duyệt giữ kết nối tới Region gần nhất nên không cần chờ DNS: Region đó sống lại là request tự về.
const FAILOVER_HOLD_MS = 30_000;
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const regionDown = res => res.status >= 500 && !res.headers.get('X-Served-Region');
let lastRegion = null; // Region phục vụ request thành công gần nhất qua Route 53
let failover = null; // { region, until } khi đang ghim Region dự phòng

function fetchVia(base, method, path, body) {
  const headers = { 'x-api-key': direct.publicKey, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function directFetch(method, path, body) {
  if (failover && Date.now() > failover.until) failover = null;
  const pinned = failover?.region;
  let res, error;
  try { res = await fetchVia(pinned ? direct.regionBases[pinned] : direct.gatewayBase, method, path, body); } catch (err) { error = err; }
  if (res && !regionDown(res)) {
    if (!pinned) lastRegion = res.headers.get('X-Served-Region') ?? lastRegion;
    return { res, retried: false };
  }
  // 5xx trước khi tới proxy thì request chưa tới backend, gửi lại an toàn; lỗi mạng chỉ gửi lại GET.
  if (error && !SAFE_METHODS.has(method)) throw error;
  const failed = pinned ?? lastRegion;
  for (const region of Object.keys(direct.regionBases).filter(r => r !== failed)) {
    try {
      const retry = await fetchVia(direct.regionBases[region], method, path, body);
      if (regionDown(retry)) continue;
      failover = { region, until: Date.now() + FAILOVER_HOLD_MS };
      return { res: retry, retried: true };
    } catch { /* thử Region kế tiếp */ }
  }
  if (res) return { res, retried: false };
  throw error;
}

// Mọi lời gọi đi qua đây để ghi vào bảng request bên phải.
// Chế độ direct: trình duyệt tự phân giải api.multi-region.io.vn, nên Region phục vụ theo vị trí người xem.
// single: hệ thống "bình thường" để so sánh, luôn gọi một Region cố định (info.singleRegion), không Route 53, không failover.
async function send(method, path, body, { single = false } = {}) {
  const started = performance.now();
  let res, retried = false;
  if (direct && single) res = await fetchVia(direct.regionBases[singleRegion], method, path, body);
  else if (direct) ({ res, retried } = await directFetch(method, path, body));
  else {
    const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(single ? { 'X-Mrapi-Single-Region': '1' } : {}) };
    res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }
  const data = await res.json().catch(() => ({}));
  const ms = Number(direct ? Math.round(performance.now() - started) : res.headers.get('X-Upstream-Ms'));
  const region = res.headers.get('X-Served-Region');
  log(method, path, res.status, region, ms, retried, single);
  return { res, data, ms, region, retried };
}

async function call(method, path, body) {
  const { res, data } = await send(method, path, body);
  if (!res.ok) throw new Error(data.error || data.message || `Lỗi ${res.status}`);
  return data;
}

// Gửi liên tục: mỗi lượt một request đọc ngẫu nhiên, chờ xong mới hẹn lượt sau (không dồn request).
const auto = { timer: null, running: false, sent: 0, errors: 0, retried: 0, ms: 0, region: {} };
const pickOne = list => list[Math.floor(Math.random() * list.length)];
function autoRequest() {
  const ids = products.map(p => p.id);
  const r = Math.random();
  if (r < 0.4 || !ids.length) return ['GET', '/products'];
  if (r < 0.6) return ['GET', '/products?q=' + encodeURIComponent(pickOne(['áo', 'tai nghe', 'bàn phím', 'sổ']))];
  if (r < 0.92) return ['GET', `/products/${pickOne(ids)}`];
  return ['GET', `/products/${9000 + Math.floor(Math.random() * 999)}`]; // 404 thật của backend
}
function renderAuto() {
  const el = $('#auto-stats');
  el.hidden = auto.sent === 0;
  const regions = Object.entries(auto.region).map(([k, v]) => `<div><b>${v}</b><span>${esc(REGION[k] ?? k)}</span></div>`).join('');
  el.innerHTML = `<div><b>${auto.sent}</b><span>đã gửi</span></div><div><b>${auto.errors}</b><span>lỗi mạng / 5xx</span></div>`
    + (auto.retried ? `<div><b>${auto.retried}</b><span>tự chuyển Region</span></div>` : '')
    + `<div><b>${auto.sent ? Math.round(auto.ms / auto.sent) : 0} ms</b><span>trung bình</span></div>${regions}`;
}
async function autoTick() {
  if (!auto.running) return;
  const [method, path] = autoRequest();
  try {
    const { res, ms, region, retried } = await send(method, path);
    auto.ms += ms || 0;
    if (res.status >= 500) auto.errors++;
    if (retried) auto.retried++;
    const key = region || '-';
    auto.region[key] = (auto.region[key] ?? 0) + 1;
  } catch (err) {
    auto.errors++;
    log(method, path, 'ERR', '-', null);
  }
  auto.sent++;
  renderAuto();
  if (auto.running) auto.timer = setTimeout(autoTick, Number($('#auto-every').value));
}
function setAuto(on) {
  auto.running = on;
  clearTimeout(auto.timer);
  $('#auto-toggle').textContent = on ? '■ Dừng' : '▶ Gửi liên tục';
  $('#auto-toggle').classList.toggle('running', on);
  if (on) {
    Object.assign(auto, { sent: 0, errors: 0, retried: 0, ms: 0, region: {} });
    renderAuto();
    autoTick();
  }
}
// Vẫn chạy khi chuyển sang tab khác (vd. mở portal xem số liệu); trình duyệt có thể giãn nhịp tab ẩn còn ~1 request/giây.
$('#auto-toggle').addEventListener('click', () => setAuto(!auto.running));

// So sánh độ trễ Multi-Region với hệ thống "bình thường" chỉ có một Region cố định.
// Một lần đo đơn lẻ dao động vài chục ms, nên:
//  - Tách hai chặng: /health (trình duyệt → gateway, không qua backend) là chỗ Multi-Region tác động;
//    /products (thêm chặng gateway → backend) là trải nghiệm thật nhưng nhiễu hơn.
//  - Đo trực tiếp cả hai Region để biết Region nào thật sự nhanh nhất từ vị trí người xem, rồi đối chiếu
//    với Region mà Route 53 chọn.
//  - Nhiều vòng, thứ tự xáo trộn mỗi vòng, so trung vị (p50); chênh lệch không vượt mức dao động (IQR) thì
//    kết luận "không khác biệt" thay vì in một con số ngẫu nhiên.
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
function stat(list) {
  const ok = list.filter(x => x.ok).map(x => x.ms).sort((a, b) => a - b);
  if (!ok.length) return { p50: null, p95: null, iqr: 0, errors: list.length };
  return { p50: pct(ok, 0.5), p95: pct(ok, 0.95), iqr: pct(ok, 0.75) - pct(ok, 0.25), errors: list.length - ok.length };
}
function mostCommon(list) {
  const count = {};
  for (const x of list) if (x.region) count[x.region] = (count[x.region] ?? 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
async function timedHealth(url) {
  const t = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    await res.text();
    return { ok: res.ok, ms: Math.round(performance.now() - t), region: res.headers.get('X-Served-Region') };
  } catch { return { ok: false, ms: null, region: null }; }
}
async function timedProducts(single) {
  try {
    const r = await send('GET', '/products', undefined, { single });
    return { ok: r.res.status < 500, ms: r.ms, region: r.region };
  } catch { return { ok: false, ms: null, region: null }; }
}
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

function renderCompare(m, done, total) {
  const other = Object.keys(m.health).find(r => r !== 'multi' && r !== singleRegion);
  const chosen = mostCommon(m.health.multi) ?? mostCommon(m.products.multi);
  const h = { multi: stat(m.health.multi), single: stat(m.health[singleRegion]), other: stat(m.health[other] ?? []) };
  const p = { multi: stat(m.products.multi), single: stat(m.products.single) };
  const ms = s => (s.p50 == null ? '-' : `${s.p50}<small> · ${s.p95}</small>`);
  const err = (...s) => s.reduce((n, x) => n + x.errors, 0);
  $('#cmp-body').innerHTML = `
    <tr><th scope="row">Multi-Region<small>Route 53 chọn ${esc(REGION[chosen] ?? chosen ?? '…')}</small></th><td class="num">${ms(h.multi)}</td><td class="num">${ms(p.multi)}</td><td class="num">${err(h.multi, p.multi)}</td></tr>
    <tr><th scope="row">Một Region cố định<small>luôn ${esc(REGION[singleRegion] ?? singleRegion)}</small></th><td class="num">${ms(h.single)}</td><td class="num">${ms(p.single)}</td><td class="num">${err(h.single, p.single)}</td></tr>
    ${other ? `<tr class="ref"><th scope="row">${esc(REGION[other] ?? other)}<small>tham khảo, chỉ đo chặng tới gateway</small></th><td class="num">${ms(h.other)}</td><td class="num">-</td><td class="num">${h.other.errors}</td></tr>` : ''}`;

  if (done < total) { $('#cmp-verdict').innerHTML = `<li>Đang đo ${done}/${total} vòng…</li>`; return; }
  const noise = (a, b) => Math.max(5, Math.round((a.iqr + b.iqr) / 2));
  const lines = [];
  // 1. Route 53 có chọn đúng Region nhanh nhất từ vị trí người xem không?
  if (h.single.p50 != null && h.other.p50 != null) {
    const fastest = h.single.p50 <= h.other.p50 ? singleRegion : other;
    const [fast, slow] = fastest === singleRegion ? [h.single, h.other] : [h.other, h.single];
    if (slow.p50 - fast.p50 <= noise(fast, slow)) lines.push(`Từ vị trí của bạn hai Region gần như ngang nhau (${h.single.p50} ms và ${h.other.p50} ms).`);
    else if (chosen === fastest) lines.push(`<b>✓ Route 53 chọn đúng ${esc(REGION[chosen])}</b>, Region nhanh nhất từ vị trí của bạn (${fast.p50} ms so với ${slow.p50} ms).`);
    else lines.push(`<b>✗ Route 53 chọn ${esc(REGION[chosen] ?? chosen ?? '?')}</b> nhưng đo được ${esc(REGION[fastest])} nhanh hơn. Thường do DNS không đi qua VPN: Route 53 thấy vị trí của resolver, không phải của bạn.`);
  }
  // 2. Chặng tới gateway: phần Multi-Region thật sự cải thiện.
  const dh = h.single.p50 - h.multi.p50;
  if (chosen === singleRegion) lines.push(`Bạn ở gần ${esc(REGION[singleRegion])} nên cả hai cách cùng về ${esc(REGION[singleRegion])}, không có chênh lệch. Người dùng ở xa (bật VPN Nhật hoặc Mỹ) mới thấy lợi ích.`);
  else if (dh > noise(h.multi, h.single)) lines.push(`<b>Chặng tới gateway nhanh hơn ${dh} ms (${Math.round(dh / h.single.p50 * 100)}%)</b> mỗi request so với hệ thống một Region.`);
  else lines.push(`Chặng tới gateway chênh ${dh} ms, chưa vượt mức dao động (±${noise(h.multi, h.single)} ms).`);
  // 3. Request thật còn chặng gateway → backend.
  if (p.multi.p50 != null && p.single.p50 != null && chosen && chosen !== singleRegion) {
    const dp = p.single.p50 - p.multi.p50;
    lines.push(dp > noise(p.multi, p.single)
      ? `Request thật tới backend nhanh hơn ${dp} ms (${Math.round(dp / p.single.p50 * 100)}%).`
      : `Request thật tới backend chỉ chênh ${dp} ms: backend của shop đặt ở một nơi, nên đi từ ${esc(REGION[chosen])} tới backend dài hơn và ăn bớt phần lợi. Đặt backend ở nhiều Region mới hưởng trọn.`);
  }
  if (err(h.multi, p.multi) < err(h.single, p.single)) lines.push('Hệ thống một Region có lỗi trong lúc đo, còn Multi-Region tự chuyển sang Region kia.');
  $('#cmp-verdict').innerHTML = lines.map(l => `<li>${l}</li>`).join('');
}

$('#cmp-run').addEventListener('click', async () => {
  const total = Number($('#cmp-rounds').value);
  const m = { health: Object.fromEntries(Object.keys(healthUrls).map(k => [k, []])), products: { multi: [], single: [] } };
  const tasks = [
    ...Object.entries(healthUrls).map(([k, url]) => async () => m.health[k].push(await timedHealth(url))),
    async () => m.products.multi.push(await timedProducts(false)),
    async () => m.products.single.push(await timedProducts(true)),
  ];
  $('#cmp-run').disabled = true;
  $('#cmp-result').hidden = false;
  try {
    // Làm nóng: mở sẵn kết nối tới mọi đích, không tính vào kết quả.
    await Promise.all(Object.values(healthUrls).map(url => fetch(url, { cache: 'no-store' }).catch(() => {})));
    await timedProducts(false); await timedProducts(true);
    for (let i = 1; i <= total; i++) {
      for (const task of shuffle([...tasks])) await task();
      renderCompare(m, i, total);
    }
  } finally {
    $('#cmp-run').disabled = false;
  }
});

function log(method, path, status, region, ms, retried = false, single = false) {
  const li = document.createElement('li');
  const cls = status === 'ERR' || status >= 500 ? 'bad' : status >= 400 ? 'warn' : 'ok';
  const rg = esc(REGION[region] ?? region ?? '-') + (retried ? ' ↻' : '');
  if (single) li.className = 'single';
  li.innerHTML = `<span class="m m-${method}">${method}</span><code>${single ? '<span class="badge" title="Hệ thống một Region, không qua định tuyến Multi-Region">1R</span>' : ''}${esc(path)}</code>
    <span class="st ${cls}">${status}</span>
    <span class="rg"${retried ? ' title="Region gần nhất lỗi, đã tự gửi lại sang Region này"' : ''}>${rg}</span><span class="ms">${ms ?? '-'} ms</span>`;
  $('#log').prepend(li);
  while ($('#log').children.length > 40) $('#log').lastChild.remove();
}

function toast(text, bad) {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast' + (bad ? ' bad' : '');
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3000);
}

async function load() {
  const params = new URLSearchParams();
  if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
  if ($('#category').value) params.set('category', $('#category').value);
  try {
    const data = await call('GET', '/products' + (params.size ? '?' + params : ''));
    products = data.products;
    renderCategories(data.categories);
    render();
  } catch (err) {
    $('#rows').innerHTML = `<tr><td colspan="7" class="empty">Không tải được: ${esc(err.message)}</td></tr>`;
  }
}

function renderCategories(categories) {
  const current = $('#category').value;
  $('#category').innerHTML = '<option value="">Tất cả danh mục</option>' + categories.map(c => `<option${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('');
  $('#category-list').innerHTML = categories.map(c => `<option value="${esc(c)}">`).join('');
}

function render() {
  const stock = products.reduce((s, p) => s + p.stock, 0);
  const value = products.reduce((s, p) => s + p.price * p.stock, 0);
  $('#stats').innerHTML = `<div><b>${products.length}</b><span>sản phẩm</span></div><div><b>${new Intl.NumberFormat('vi-VN').format(stock)}</b><span>tổng tồn kho</span></div><div><b>${money(value)}</b><span>giá trị tồn kho</span></div>`;
  $('#rows').innerHTML = products.length ? products.map(p => `
    <tr>
      <td class="id">${p.id}</td>
      <td><b>${esc(p.name)}</b></td>
      <td><span class="tag">${esc(p.category)}</span></td>
      <td class="num">${money(p.price)}</td>
      <td class="num ${p.stock < 20 ? 'low' : ''}">${p.stock}</td>
      <td class="muted">${when(p.updatedAt)}</td>
      <td class="row-actions">
        <button class="btn sm" data-edit="${p.id}">Sửa</button>
        <button class="btn sm danger-ghost" data-delete="${p.id}">Xóa</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">Không có sản phẩm nào.</td></tr>';
}

function openForm(product) {
  editing = product;
  const form = $('#product-form');
  form.reset();
  $('#form-error').textContent = '';
  $('#form-title').textContent = product ? `Sửa sản phẩm #${product.id}` : 'Thêm sản phẩm';
  if (product) for (const k of ['name', 'category', 'price', 'stock']) form.elements[k].value = product[k];
  $('#form-dialog').showModal();
  form.elements.name.focus();
}

$('#product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const f = event.target.elements;
  const body = { name: f.name.value, category: f.category.value, price: Number(f.price.value), stock: Number(f.stock.value) };
  $('#save').disabled = true;
  try {
    const saved = editing ? await call('PUT', `/products/${editing.id}`, body) : await call('POST', '/products', body);
    $('#form-dialog').close();
    toast(editing ? `Đã lưu thay đổi #${saved.id}` : `Đã thêm sản phẩm #${saved.id}`);
    await load();
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    $('#save').disabled = false;
  }
});

$('#rows').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]');
  const del = event.target.closest('[data-delete]');
  if (edit) {
    // Lấy bản mới nhất từ backend trước khi sửa (GET theo id).
    try { openForm(await call('GET', `/products/${edit.dataset.edit}`)); } catch (err) { toast(err.message, true); load(); }
  }
  if (del) {
    deleting = products.find(p => p.id === Number(del.dataset.delete));
    $('#delete-text').textContent = `Sản phẩm #${deleting.id} "${deleting.name}" sẽ bị xóa khỏi backend.`;
    $('#delete-dialog').showModal();
  }
});

$('#confirm-delete').addEventListener('click', async event => {
  event.preventDefault();
  try {
    await call('DELETE', `/products/${deleting.id}`);
    toast(`Đã xóa sản phẩm #${deleting.id}`);
    $('#delete-dialog').close();
    await load();
  } catch (err) {
    toast(err.message, true);
  }
});

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('#add').addEventListener('click', () => openForm(null));
$('#search').addEventListener('submit', e => { e.preventDefault(); load(); });
$('#category').addEventListener('change', load);
$('#clear-log').addEventListener('click', () => ($('#log').innerHTML = ''));

fetch('/api/info').then(r => r.json()).catch(() => ({})).then(info => {
  if (info.browserDirect) direct = { gatewayBase: info.gatewayBase, regionBases: info.regionBases ?? {}, publicKey: info.publicKey };
  singleRegion = info.singleRegion;
  healthUrls = info.healthUrls;
  if (singleRegion && healthUrls) $('#compare').hidden = false;
  $('#conn').className = 'conn ' + (info.viaGateway ? 'on' : 'off');
  $('#conn').innerHTML = direct
    ? `<span class="dot"></span>Trình duyệt gọi thẳng gateway <code>${esc(info.target)}</code>`
    : info.viaGateway
      ? `<span class="dot"></span>Qua gateway (từ web server) <code>${esc(info.target)}</code>`
      : `<span class="dot"></span>Gọi thẳng backend <code>${esc(info.target)}</code>`;
  if (direct) {
    $('#log-note').textContent = 'Mỗi thao tác là một request thật từ chính trình duyệt này tới api.multi-region.io.vn; Route 53 chọn Region gần vị trí của bạn. Region đó lỗi thì tự gửi lại sang Region kia (dấu ↻).';
  }
  load();
});
