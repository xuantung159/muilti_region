import { Table2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatBucket, formatCompact, formatTick } from '../domain/format';
import type { RangeKey } from '../domain/types';
import { Card, EmptyState } from './ui';

export interface SeriesDef {
  key: string;
  name: string;
  color: string; // biến CSS, ví dụ var(--series-1)
}

// null = không có dữ liệu cho ô đó: vẽ thành khoảng trống, không nối qua, không vẽ 0.
export type ChartRow = { t: number } & Record<string, number | null>;

export const NO_DATA_LABEL = 'Không có dữ liệu';

// Có ô nào thiếu dữ liệu (null) trong các series đang vẽ không.
export const rowsHaveGaps = (rows: ChartRow[], series: SeriesDef[]): boolean => rows.some((r) => series.some((s) => r[s.key] === null || r[s.key] === undefined));

interface ChartProps {
  title: string;
  subtitle?: string;
  rows: ChartRow[];
  series: SeriesDef[];
  range: RangeKey;
  format?: (n: number) => string;
  kind: 'line' | 'stacked-bar';
  badge?: ReactNode;
  lead?: ReactNode; // nội dung tóm tắt đặt phía trên biểu đồ
  // Mốc t của các ô đang thu thập (partial): đánh dấu trên biểu đồ và trong bảng.
  partial?: number[];
  footer?: ReactNode;
}

function TooltipBox({ active, payload, label, series, format, partial }: { active?: boolean; payload?: { dataKey?: unknown; value?: unknown }[]; label?: unknown; series: SeriesDef[]; format: (n: number) => string; partial?: number[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink2">
        {formatBucket(Number(label))}
        {partial?.includes(Number(label)) && ' (đang thu thập)'}
      </div>
      {series.map((s) => {
        const item = payload.find((p) => p.dataKey === s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 text-ink">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="font-semibold tabular-nums">{typeof item?.value === 'number' ? format(item.value) : NO_DATA_LABEL}</span>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ rows, series, format, partial }: { rows: ChartRow[]; series: SeriesDef[]; format: (n: number) => string; partial?: number[] }) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface text-ink2">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Thời điểm</th>
            {series.map((s) => (
              <th key={s.key} className="py-1.5 pr-3 text-right font-medium">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums text-ink">
          {rows.map((row) => (
            <tr key={row.t} className="border-t border-line">
              <td className="py-1 pr-3">
                {formatBucket(row.t)}
                {partial?.includes(row.t) && <span className="ml-1 text-muted">(đang thu thập)</span>}
              </td>
              {series.map((s) => {
                const v = row[s.key];
                return (
                  <td key={s.key} className="py-1 pr-3 text-right">
                    {typeof v === 'number' ? format(v) : <span className="italic text-muted">N/A</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimeChart({ title, subtitle, rows, series, range, format = formatCompact, kind, badge, lead, partial = [], footer }: ChartProps) {
  const [showTable, setShowTable] = useState(false);
  const gaps = rowsHaveGaps(rows, series);
  const partialMarks = partial.map((t) => <ReferenceLine key={`partial-${t}`} x={t} stroke="var(--gap)" strokeDasharray="4 3" />);
  const axisTick = { fill: 'var(--muted)', fontSize: 12 };
  const shared = { data: rows, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid stroke="var(--grid)" vertical={false} />
      <XAxis dataKey="t" tickFormatter={(t: number) => formatTick(t, range)} tick={axisTick} stroke="var(--axis)" tickLine={false} minTickGap={48} />
      <YAxis tickFormatter={(n: number) => format(n)} tick={axisTick} axisLine={false} tickLine={false} width={52} />
    </>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            {title}
            {badge}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink2">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink2 hover:bg-raised"
        >
          <Table2 aria-hidden className="size-3.5" />
          {showTable ? 'Xem biểu đồ' : 'Xem bảng'}
        </button>
      </div>

      {lead}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={kind === 'line' ? 'h-0.5 w-4 rounded' : 'size-2.5 rounded-sm'} style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
        {gaps && (
          <li className="flex items-center gap-1.5" title="Ô không có dữ liệu được để trống, không vẽ thành 0">
            <span aria-hidden className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--gap)' }} />
            Khoảng trống = không có dữ liệu
          </li>
        )}
        {partial.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0 border-l-2 border-dashed" style={{ borderColor: 'var(--gap)' }} />
            Ô cuối đang thu thập (chưa đủ thời gian, số liệu còn thiếu)
          </li>
        )}
      </ul>

      <div className="mt-2">
        {rows.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu chuỗi thời gian">Nguồn dữ liệu chưa trả về điểm dữ liệu nào cho khoảng thời gian này.</EmptyState>
        ) : showTable ? (
          <DataTable rows={rows} series={series} format={format} partial={partial} />
        ) : (
          <div className="h-64" role="img" aria-label={`${title}. Bấm "Xem bảng" để đọc số liệu.`}>
            <ResponsiveContainer width="100%" height="100%">
              {kind === 'line' ? (
                <LineChart {...shared}>
                  {axes}
                  <Tooltip content={<TooltipBox series={series} format={format} partial={partial} />} cursor={{ stroke: 'var(--axis)' }} />
                  {partialMarks}
                  {series.map((s) => (
                    <Line
                      connectNulls={false}
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.name}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart {...shared} barCategoryGap={1}>
                  {axes}
                  <Tooltip content={<TooltipBox series={series} format={format} partial={partial} />} cursor={{ fill: 'var(--raised)' }} />
                  {partialMarks}
                  {series.map((s, i) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.name}
                      stackId="total"
                      fill={s.color}
                      radius={i === series.length - 1 ? [2, 2, 0, 0] : 0}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {footer && <div className="mt-2 text-xs text-ink2">{footer}</div>}
    </Card>
  );
}
