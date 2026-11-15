// Dữ liệu mẫu cho trang Định tuyến: mỗi quốc gia được Route 53 latency-based đưa về Region có độ trễ thấp hơn.
// Số liệu minh họa, không phải CloudWatch.
import { RANGES } from '../../domain/range';
import type { RangeKey, RegionCode, RouteStat } from '../../domain/types';

const SG: RegionCode = 'ap-southeast-1';
const TYO: RegionCode = 'ap-northeast-1';

// Request mỗi giờ của từng nguồn trong dữ liệu mẫu.
const SAMPLE: { country: string; servedRegion: RegionCode; perHour: number }[] = [
  { country: 'VN', servedRegion: SG, perHour: 420 },
  { country: 'SG', servedRegion: SG, perHour: 160 },
  { country: 'IN', servedRegion: SG, perHour: 95 },
  { country: 'DE', servedRegion: SG, perHour: 60 },
  { country: 'AU', servedRegion: SG, perHour: 48 },
  { country: 'JP', servedRegion: TYO, perHour: 310 },
  { country: 'KR', servedRegion: TYO, perHour: 140 },
  { country: 'US', servedRegion: TYO, perHour: 120 },
  { country: 'BR', servedRegion: TYO, perHour: 12 },
];

export function buildRoutes(range: RangeKey, now: number): RouteStat[] {
  const { buckets, bucketMs } = RANGES[range];
  const hours = (buckets * bucketMs) / 3_600_000;
  return SAMPLE.map((s) => ({ country: s.country, servedRegion: s.servedRegion, requests: Math.round(s.perHour * hours), lastSeen: now }))
    .sort((a, b) => b.requests - a.requests);
}
