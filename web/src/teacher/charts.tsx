// رسوم بيانية خفيفة بلا مكتبات: أشرطة أفقية، وأشرطة تقدم مكدسة، وخط زمني. تتجه من اليمين إلى اليسار.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const fmt = (v: number | null | undefined, d = 1) => (v == null ? '—' : v.toFixed(d));

/** تلميح يتبع المؤشر داخل حاوية الرسم */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const show = (e: React.MouseEvent | React.FocusEvent, body: ReactNode) => {
    const r = box.current!.getBoundingClientRect();
    const t = (e as React.MouseEvent).clientX != null ? (e as React.MouseEvent) : null;
    const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: (t ? t.clientX : el.left + el.width / 2) - r.left, y: (t ? t.clientY : el.top) - r.top, body });
  };
  const node = tip && (
    <div className="viz-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.body}</div>
  );
  return { box, show, hide: () => setTip(null), node };
}

export function Legend({ items }: { items: { label: string; swatch: string; kind?: 'bar' | 'line' | 'tick' }[] }) {
  return (
    <div className="viz-legend">
      {items.map((i) => (
        <span key={i.label}><i className={`sw ${i.kind ?? 'bar'}`} style={{ background: i.swatch }} />{i.label}</span>
      ))}
    </div>
  );
}

/** أشرطة أفقية لقيمة على السلم، مع علامة اختيارية لمتوسط الصف */
export function HBars({ rows, max, unit, markerLabel, empty = 'لا توجد تقديرات بعد', valueText }: {
  rows: { key: string | number; label: string; value: number | null; marker?: number | null; n?: number }[];
  max: number; unit?: string; markerLabel?: string; empty?: string; valueText?: (v: number) => string;
}) {
  const vt = (v: number | null) => (v == null ? empty : valueText ? valueText(v) : `${fmt(v)} من ${max}${unit ?? ''}`);
  const t = useTip();
  return (
    <div className="viz hbars" ref={t.box} onMouseLeave={t.hide}>
      {rows.map((r) => (
        <div key={r.key} className="hbar-row">
          <div className="hbar-label" title={r.label}>{r.label}</div>
          <div className="hbar-track" tabIndex={0}
            onMouseMove={(e) => t.show(e, <><b>{r.label}</b><div>{vt(r.value)}{r.n ? ` · ${r.n} تقدير` : ''}</div>{r.marker != null && <div>{markerLabel}: {fmt(r.marker)}</div>}</>)}
            onFocus={(e) => t.show(e, <><b>{r.label}</b><div>{vt(r.value)}</div></>)} onBlur={t.hide}>
            {r.value != null && <i className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />}
            {r.marker != null && <i className="hbar-marker" style={{ insetInlineStart: `calc(${(r.marker / max) * 100}% - 1.5px)` }} />}
          </div>
          <div className="hbar-value">{r.value == null ? <span className="muted">—</span> : valueText ? r.value : fmt(r.value)}</div>
        </div>
      ))}
      {t.node}
    </div>
  );
}

/** أشرطة مكدسة بنسبة 100% (مكتمل / قيد الإنجاز / لم يبدأ) */
export function StackedBars({ rows, segments }: {
  rows: { key: string; label: string; values: number[] }[];
  segments: { label: string; color: string }[];
}) {
  const t = useTip();
  return (
    <div className="viz hbars" ref={t.box} onMouseLeave={t.hide}>
      {rows.map((r) => {
        const total = r.values.reduce((a, b) => a + b, 0) || 1;
        return (
          <div key={r.key} className="hbar-row">
            <div className="hbar-label">{r.label}</div>
            <div className="stack-track">
              {r.values.map((v, i) => v > 0 && (
                <i key={i} className="stack-seg" tabIndex={0} style={{ width: `${(v / total) * 100}%`, background: segments[i].color }}
                  onMouseMove={(e) => t.show(e, <><b>{r.label}</b><div>{segments[i].label}: {v} ({Math.round((v / total) * 100)}%)</div></>)}
                  onFocus={(e) => t.show(e, <><b>{r.label}</b><div>{segments[i].label}: {v}</div></>)} onBlur={t.hide} />
              ))}
            </div>
            <div className="hbar-value">{r.values[0]}/{total}</div>
          </div>
        );
      })}
      {t.node}
    </div>
  );
}

/** خط زمني عبر الحصص؛ المحور يبدأ من اليمين (الحصة 1) */
export function LineChart({ labels, series, max, height = 220 }: {
  labels: string[];
  series: { name: string; color: string; values: (number | null)[]; dashed?: boolean }[];
  max: number; height?: number;
}) {
  const t = useTip();
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = t.box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 14, bottom: 30, left: 14, right: 34 };
  const iw = w - pad.left - pad.right, ih = height - pad.top - pad.bottom;
  const n = labels.length;
  // RTL: العنصر الأول عند اليمين
  const x = (i: number) => pad.left + (n === 1 ? iw / 2 : iw - (i * iw) / (n - 1));
  const y = (v: number) => pad.top + ih - (v / max) * ih;
  const ticks = Array.from({ length: max + 1 }, (_, i) => i);
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
    return d;
  };
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - pad.left - px); if (d < bd) { bd = d; best = i; } }
    setHover(best);
    t.show(e, <><b>{labels[best]}</b>{series.map((s) => <div key={s.name}><i className="sw line" style={{ background: s.color }} /> {s.name}: {fmt(s.values[best])}</div>)}</>);
  };
  return (
    <div className="viz" ref={t.box} onMouseLeave={() => { setHover(null); t.hide(); }}>
      <svg width={w} height={height} role="img" aria-label={`رسم خطي: ${series.map((s) => s.name).join('، ')}`} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={w - pad.right} y1={y(v)} y2={y(v)} className="viz-grid" />
            <text x={w - pad.right + 8} y={y(v)} dy="0.35em" className="viz-axis" textAnchor="start">{v}</text>
          </g>
        ))}
        {labels.map((l, i) => <text key={l} x={x(i)} y={height - 8} className="viz-axis" textAnchor="middle">{l}</text>)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} className="viz-cross" />}
        {series.map((s) => (
          <g key={s.name}>
            <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
            {s.values.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5.5 : 4} fill={s.color} className="viz-dot" />)}
          </g>
        ))}
        <rect x={pad.left} y={pad.top} width={iw} height={ih} fill="transparent" onMouseMove={onMove} />
      </svg>
      {t.node}
    </div>
  );
}

/** جدول بديل للرسم: للقراءة الدقيقة وقارئات الشاشة */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number | null)[][] }) {
  return (
    <details className="viz-table">
      <summary className="tiny">عرض البيانات جدولًا</summary>
      <div className="table-scroll">
        <table className="grid">
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
