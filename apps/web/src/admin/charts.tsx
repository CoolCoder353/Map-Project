import { Table2, LineChart as LineIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface Series {
  key: string;
  label: string;
  /** Categorical slot (1 or 2), fixed per entity so colours never move with filters. */
  slot: 1 | 2;
}

const axisTick = { fill: 'var(--text-2)', fontSize: 11 };

function TooltipBox({ active, payload, label, format, labelFormat }: { active?: boolean; payload?: Array<{ dataKey: string; name: string; value: number; color: string }>; label?: string; format: (v: number) => string; labelFormat: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{labelFormat(String(label))}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span className="chart-key" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <strong className="num">{format(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

interface ChartCardProps<T> {
  title: string;
  description?: string;
  data: T[];
  xKey: keyof T & string;
  series: Series[];
  kind: 'line' | 'bar' | 'stacked-bar';
  height?: number;
  format?: (v: number) => string;
  xFormat?: (v: string) => string;
  empty?: ReactNode;
  layout?: 'horizontal' | 'vertical';
}

/** A chart with a title, legend (2+ series), hover tooltip and a table view. */
export function ChartCard<T extends Record<string, unknown>>({
  title,
  description,
  data,
  xKey,
  series,
  kind,
  height = 220,
  format = (v) => String(v),
  xFormat = (v) => v,
  empty,
  layout = 'horizontal',
}: ChartCardProps<T>) {
  const [table, setTable] = useState(false);
  const id = useId();
  const colour = (s: Series) => `var(--series-${s.slot})`;
  const vertical = layout === 'vertical';
  return (
    <section className="chart-card" aria-labelledby={`${id}-t`}>
      <header className="chart-head">
        <div>
          <h3 id={`${id}-t`}>{title}</h3>
          {description && <p className="chart-desc">{description}</p>}
        </div>
        <button type="button" className="icon-btn" aria-pressed={table} aria-label={table ? 'Show chart' : 'Show as table'} title={table ? 'Show chart' : 'Show as table'} onClick={() => setTable((t) => !t)}>
          {table ? <LineIcon /> : <Table2 />}
        </button>
      </header>
      {data.length === 0 ? (
        <div className="chart-empty">{empty ?? 'No data for this period.'}</div>
      ) : table ? (
        <div className="table-wrap" style={{ maxHeight: height + 40 }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{vertical ? 'Name' : 'Time'}</th>
                {series.map((s) => (
                  <th scope="col" key={s.key} className="num-col">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <td>{xFormat(String(row[xKey]))}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num-col num">{row[s.key] == null ? '–' : format(Number(row[s.key]))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'line' ? (
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey={xKey as string} tick={axisTick} tickFormatter={xFormat} stroke="var(--border-strong)" minTickGap={28} />
                <YAxis tick={axisTick} tickFormatter={(v: number) => format(v)} stroke="transparent" width={56} />
                <Tooltip content={<TooltipBox format={format} labelFormat={xFormat} />} cursor={{ stroke: 'var(--border-strong)' }} />
                {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />}
                {series.map((s) => (
                  <Line key={s.key} dataKey={s.key} name={s.label} stroke={colour(s)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={vertical ? 6 : '20%'}>
                <CartesianGrid stroke="var(--border)" vertical={vertical} horizontal={!vertical} />
                {vertical ? (
                  <>
                    <XAxis type="number" tick={axisTick} tickFormatter={(v: number) => format(v)} stroke="transparent" />
                    <YAxis type="category" dataKey={xKey as string} tick={axisTick} stroke="var(--border-strong)" width={90} />
                  </>
                ) : (
                  <>
                    <XAxis dataKey={xKey as string} tick={axisTick} tickFormatter={xFormat} stroke="var(--border-strong)" minTickGap={16} />
                    <YAxis tick={axisTick} tickFormatter={(v: number) => format(v)} stroke="transparent" width={48} allowDecimals={false} />
                  </>
                )}
                <Tooltip content={<TooltipBox format={format} labelFormat={xFormat} />} cursor={{ fill: 'var(--surface-3)' }} />
                {series.length > 1 && <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />}
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={colour(s)}
                    stackId={kind === 'stacked-bar' ? 'stack' : undefined}
                    stroke="var(--surface)"
                    strokeWidth={kind === 'stacked-bar' ? 1 : 0}
                    radius={kind === 'stacked-bar' ? (i === series.length - 1 ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
