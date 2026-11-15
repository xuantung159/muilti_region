// Bản đồ thế giới: quốc gia gửi request tô vàng, Region phục vụ chấm xanh, đường cong nối nguồn → Region.
// Dữ liệu địa lý: world-atlas (Natural Earth 1:50m, public domain), tải riêng khi mở trang để không làm nặng bundle chính.
import { geoArea, geoCentroid, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import countries from 'i18n-iso-countries';
import { useEffect, useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { formatNumber } from '../domain/format';
import { type RegionCode, regionName, type RouteStat } from '../domain/types';

export const REQUEST_COLOR = '#facc15'; // vàng: nơi request xuất phát
export const REGION_COLOR = '#16a34a'; // xanh: Region nhận và phục vụ request

export const REGION_COORDS: Record<RegionCode, [number, number]> = {
  'ap-southeast-1': [103.82, 1.35], // Singapore
  'ap-northeast-1': [139.69, 35.68], // Tokyo
};

const WIDTH = 960;
const HEIGHT = 500;

type CountryFeature = Feature<Geometry, { name?: string }>;

const displayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['vi'], { type: 'region' }) : null;
export function countryLabel(code: string): string {
  if (code === 'ZZ') return 'Không xác định';
  try { return displayNames?.of(code) ?? code; } catch { return code; }
}

// Tâm của mảnh đất lớn nhất (tránh tâm của Pháp, Mỹ... rơi ra biển vì lãnh thổ hải ngoại).
function mainCentroid(f: CountryFeature): [number, number] {
  const g = f.geometry;
  if (g.type !== 'MultiPolygon') return geoCentroid(f);
  const polygons = (g as MultiPolygon).coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }) as Polygon);
  const largest = polygons.reduce((best, p) => (geoArea(p) > geoArea(best) ? p : best));
  return geoCentroid(largest);
}

function useWorld(): CountryFeature[] | null {
  const [world, setWorld] = useState<CountryFeature[] | null>(null);
  useEffect(() => {
    let alive = true;
    void import('world-atlas/countries-50m.json').then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology<{ countries: GeometryCollection<{ name?: string }> }>;
      const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name?: string }>;
      if (alive) setWorld(fc.features);
    });
    return () => { alive = false; };
  }, []);
  return world;
}

export function RoutingMap({ routes }: { routes: RouteStat[] }) {
  const world = useWorld();
  const projection = useMemo(() => geoNaturalEarth1().scale(175).translate([WIDTH / 2, HEIGHT / 2 + 20]), []);
  const path = useMemo(() => geoPath(projection), [projection]);

  const byNumeric = useMemo(() => {
    const m = new Map<string, CountryFeature>();
    for (const f of world ?? []) if (f.id !== undefined) m.set(String(f.id).padStart(3, '0'), f);
    return m;
  }, [world]);

  const origins = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of routes) totals.set(r.country, (totals.get(r.country) ?? 0) + r.requests);
    return totals;
  }, [routes]);

  const arcs = useMemo(() => {
    if (!world) return [];
    const max = Math.max(1, ...routes.map((r) => r.requests));
    return routes.flatMap((r) => {
      const numeric = countries.alpha2ToNumeric(r.country);
      const f = numeric ? byNumeric.get(numeric) : undefined;
      if (!f) return [];
      const from = projection(mainCentroid(f));
      const to = projection(REGION_COORDS[r.servedRegion]);
      if (!from || !to) return [];
      // Đường cong bậc hai, đỉnh lệch vuông góc với đoạn thẳng để các tuyến không chồng lên nhau.
      const [x1, y1] = from; const [x2, y2] = to;
      const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(80, len * 0.25);
      const cx = (x1 + x2) / 2 - (dy / len) * bend; const cy = (y1 + y2) / 2 + (dx / len) * bend;
      return [{ key: `${r.country}-${r.servedRegion}`, r, from, d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, width: 1.5 + 4.5 * Math.sqrt(r.requests / max) }];
    });
  }, [world, routes, byNumeric, projection]);

  const activeRegions = new Set(routes.map((r) => r.servedRegion));

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Bản đồ: quốc gia gửi request và Region phục vụ" className="h-auto w-full">
        <defs>
          <marker id="route-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={REGION_COLOR} />
          </marker>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="transparent" />
        {world ? (
          <g>
            {world.map((f, i) => {
              const numeric = f.id !== undefined ? String(f.id).padStart(3, '0') : '';
              const alpha2 = numeric ? countries.numericToAlpha2(numeric) : undefined;
              const requests = alpha2 ? origins.get(alpha2) : undefined;
              return (
                <path key={`${numeric}-${i}`} d={path(f) ?? ''} fill={requests ? REQUEST_COLOR : 'var(--raised)'}
                  stroke={requests ? '#a16207' : 'var(--axis)'} strokeWidth={requests ? 0.8 : 0.4} data-country={alpha2}>
                  <title>{alpha2 ? `${countryLabel(alpha2)}${requests ? `: ${formatNumber(requests)} request` : ''}` : (f.properties?.name ?? '')}</title>
                </path>
              );
            })}
          </g>
        ) : (
          <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" fill="var(--muted)" fontSize="16">Đang tải bản đồ…</text>
        )}

        {arcs.map((a) => (
          <g key={a.key}>
            <path d={a.d} fill="none" stroke={REGION_COLOR} strokeOpacity={0.85} strokeWidth={a.width} strokeLinecap="round" markerEnd="url(#route-arrow)" className="route-arc">
              <title>{`${countryLabel(a.r.country)} → ${regionName(a.r.servedRegion)}: ${formatNumber(a.r.requests)} request`}</title>
            </path>
            <circle cx={a.from[0]} cy={a.from[1]} r={3.5} fill={REQUEST_COLOR} stroke="#a16207" strokeWidth={1} />
          </g>
        ))}

        {(Object.keys(REGION_COORDS) as RegionCode[]).map((code) => {
          const p = projection(REGION_COORDS[code]);
          if (!p) return null;
          const active = activeRegions.has(code);
          return (
            <g key={code} transform={`translate(${p[0]},${p[1]})`}>
              {active && <circle r={16} fill={REGION_COLOR} opacity={0.25} className="region-pulse" />}
              <circle r={8} fill={REGION_COLOR} stroke="#ffffff" strokeWidth={2} />
              {/* Cả hai nhãn đặt về phía trái điểm: Tokyo nằm sát mép phải bản đồ. */}
              <text x={-14} y={code === 'ap-southeast-1' ? 24 : -16} textAnchor="end" fontSize="15" fontWeight={700}
                fill="var(--ink)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>
                {regionName(code)}
                <tspan x={-14} dy="16" fontSize="12" fontWeight={500} fill="var(--ink-2)">{code}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink2">
        <span className="inline-flex items-center gap-2"><span className="inline-block size-3 rounded-sm" style={{ background: REQUEST_COLOR }} /> Nơi request xuất phát</span>
        <span className="inline-flex items-center gap-2"><span className="inline-block size-3 rounded-full" style={{ background: REGION_COLOR }} /> Region nhận và phục vụ request</span>
        <span className="inline-flex items-center gap-2"><span className="inline-block h-0.5 w-6" style={{ background: REGION_COLOR }} /> Tuyến định tuyến, càng dày càng nhiều request</span>
      </figcaption>
    </figure>
  );
}
