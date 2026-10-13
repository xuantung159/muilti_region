import type { RangeKey } from './types';

const MINUTE = 60_000;

export const RANGES: Record<RangeKey, { label: string; buckets: number; bucketMs: number }> = {
  '1h': { label: '1 giờ', buckets: 60, bucketMs: MINUTE },
  '6h': { label: '6 giờ', buckets: 72, bucketMs: 5 * MINUTE },
  '24h': { label: '24 giờ', buckets: 96, bucketMs: 15 * MINUTE },
  '7d': { label: '7 ngày', buckets: 84, bucketMs: 120 * MINUTE },
};

export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
