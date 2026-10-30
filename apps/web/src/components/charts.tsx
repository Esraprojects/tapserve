/**
 * Small dependency-free SVG charts (server-rendered, tiny for low-end devices).
 * One series per chart, so no legend: the card title names what is plotted.
 * Hover or focus a mark to see its exact value; every chart has a table beside it on the reports page.
 */

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * exp >= value)!;
  return step * exp;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/** Columns over time (e.g. daily sales). Values are in santim; axis shows birr. */
export function ColumnChart({ data, label, format }: {
  data: { label: string; value: number }[];
  label: string;
  format: (santim: number) => string;
}) {
  const width = 640;
  const height = 200;
  const pad = { top: 28, right: 8, bottom: 24, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value / 100)));
  const ticks = [0, max / 2, max];
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, band - 2);
  const y = (birr: number) => pad.top + plotH - (birr / max) * plotH;
  const every = Math.ceil(data.length / 10);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full overflow-visible">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeWidth={1} />
          <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--chart-text)">{compact(tick)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.left + i * band + (band - barW) / 2;
        const h = Math.max(0, (d.value / 100 / max) * plotH);
        const top = pad.top + plotH - h;
        const r = Math.min(4, h, barW / 2);
        // Rounded data end, square at the baseline.
        const path = h > 0
          ? `M${x},${pad.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + plotH} Z`
          : "";
        const tipX = Math.min(Math.max(x + barW / 2, pad.left + 60), width - 60);
        return (
          <g key={d.label} className="chart-hit" tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}>
            <rect x={pad.left + i * band} y={pad.top} width={band} height={plotH} fill="transparent" />
            {path && <path d={path} className="chart-mark" />}
            {i % every === 0 && (
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--chart-text)">{d.label}</text>
            )}
            <g className="chart-tip">
              <rect x={tipX - 58} y={2} width={116} height={20} rx={6} fill="var(--chart-text)" />
              <text x={tipX} y={16} textAnchor="middle" fontSize={11} fill="white" fontWeight={600}>{format(d.value)}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars for a ranking (payment methods, top items); value at the bar tip. */
export function BarList({ data, format }: { data: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="truncate">{d.label}</span>
            <span className="tabular-nums text-stone-600 dark:text-stone-300">{format(d.value)}</span>
          </div>
          <div className="h-2.5 w-full" aria-hidden>
            <div className="h-2.5 rounded-r" style={{ width: `${(d.value / max) * 100}%`, background: "var(--chart-series)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
