// Giả lập "một Region gặp lỗi" để trình diễn failover trên web.
//
// Chỉ có MỘT bản ghi trong bảng control (Global Table):
//   HEALTH / SIMULATED_OUTAGE   { region, startedAt, until, cooldownUntil, startedBy, ... }
// Vì chỉ một bản ghi nên tại mọi thời điểm nhiều nhất một Region bị giả lập lỗi,
// kể cả khi hai Region ghi cùng lúc (Global Table giữ bản ghi cuối cùng).
// Hết `until` thì cờ tự hết hiệu lực, không cần xoá.
export const OUTAGE_KEY = { PK: 'HEALTH', SK: 'SIMULATED_OUTAGE' };
export const OUTAGE_REGIONS = ['ap-southeast-1', 'ap-northeast-1'];
// Giới hạn cứng: /health bỏ qua cờ còn hạn dài hơn mức này dù bản ghi có ghi gì.
// Portal cho tối đa 10 phút; thêm 1 phút cho lệch đồng hồ giữa các Lambda.
export const MAX_OUTAGE_MS = 11 * 60_000;

export function outageActive(item, region, now = Date.now()) {
  return Boolean(item) && item.region === region && Number.isFinite(item.until)
    && item.until > now && item.until - now <= MAX_OUTAGE_MS;
}
