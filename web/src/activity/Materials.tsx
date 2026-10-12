// عرض المادة التعليمية: موقف، أمثلة، معايير، تفكير بصوت مسموع (يُكشف تدريجيًا)، بطاقات نموذج.
import { Fragment, useState } from 'react';
import type { Material } from '../../../shared/types';
import { Icon } from '../icons';

export function Materials({ items, activityId, preview }: { items: Material[]; activityId: string; preview?: boolean }) {
  // ما يلي «التفكير بصوت مسموع» (النموذج المكتمل والضعيف) لا يظهر إلا بعد متابعة خطوات التفكير كلها
  const [, force] = useState(0);
  const thinkIdx = items.findIndex((m) => m.type === 'thinkAloud');
  const done = preview || thinkIdx < 0 || thinkAloudComplete(items, activityId);
  return (
    <div className="stack">
      {items.map((m, i) => (thinkIdx >= 0 && i > thinkIdx && !done) ? null
        : <MaterialView key={i} m={m} storeKey={`ts-think:${activityId}:${i}`} preview={preview} onStep={() => force((x) => x + 1)} />)}
    </div>
  );
}

function MaterialView({ m, storeKey, preview, onStep }: { m: Material; storeKey: string; preview?: boolean; onStep?: () => void }) {
  const el = MaterialInner({ m, storeKey, preview, onStep });
  if (preview && (m as any).proposed && el) {
    return <div><span className="proposed-tag">مادة مقترحة من المطوّر للمراجعة</span>{el}</div>;
  }
  return el;
}

function MaterialInner({ m, storeKey, preview, onStep }: { m: Material; storeKey: string; preview?: boolean; onStep?: () => void }) {
  switch (m.type) {
    case 'scenario':
    case 'task':
      return (
        <section className="material">
          <h3>{m.title}</h3>
          <div className="scenario">{m.text}</div>
        </section>
      );
    case 'note':
      return <div className="alert info"><Icon name="info" size={18} /><div><b>{m.title}: </b>{m.text}</div></div>;
    case 'examples':
      return (
        <section className="material">
          <h3>{m.title}</h3>
          <div className="examples">{m.items.map((it, i) => <div key={i} className="example"><b>{it.label}</b><span>{it.text}</span></div>)}</div>
        </section>
      );
    case 'criteria':
      if (m.locked && !preview) {
        return (
          <section className="material">
            <h3>{m.title}</h3>
            <div className="locked-box"><Icon name="lock" size={18} style={{ verticalAlign: -4 }} /> تظهر هنا بعد أن تكتبي المعايير التي استنتجتِها بنفسكِ وتحفظيها.</div>
          </section>
        );
      }
      return (
        <section className="material">
          <h3>{m.title}{preview && m.revealAfter ? <span className="badge warn" style={{ marginInlineStart: 8 }}>تُكشف للطالبة بعد محاولتها</span> : null}</h3>
          <div className="criteria-list">{(m.items ?? []).map((it, i) => <div key={i} className="criterion"><b>{it.label}</b>{it.text}</div>)}</div>
        </section>
      );
    case 'thinkAloud':
      return <ThinkAloud m={m} storeKey={storeKey} preview={preview} onStep={onStep} />;
    case 'modelCard':
      return (
        <section className={`model-card ${m.tone}`}>
          <h3 className="row" style={{ gap: 6 }}><Icon name={m.tone === 'strong' ? 'check' : 'alert'} size={18} /> {m.title}</h3>
          <dl>{m.rows.map((r) => <Fragment key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></Fragment>)}</dl>
          {m.notes && <ul className="small" style={{ marginBottom: 0 }}>{m.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </section>
      );
    default:
      return null;
  }
}

function ThinkAloud({ m, storeKey, preview, onStep }: { m: Extract<Material, { type: 'thinkAloud' }>; storeKey: string; preview?: boolean; onStep?: () => void }) {
  const [n, setN] = useState<number>(() => {
    if (preview) return m.steps.length;
    try { return Math.max(1, Number(localStorage.getItem(storeKey)) || 1); } catch { return 1; }
  });
  const reveal = () => {
    const next = Math.min(n + 1, m.steps.length);
    setN(next);
    try { localStorage.setItem(storeKey, String(next)); } catch { /* */ }
    onStep?.();
  };
  return (
    <section className="material">
      <h3>{m.title}</h3>
      {m.intro && <p className="muted">{m.intro}</p>}
      <div className="think">
        {m.steps.slice(0, n).map((s, i) => (
          <div key={i} className="think-step">
            <b>{s.title}</b>
            <div>{s.text}</div>
            {s.list && <ul>{s.list.map((x, j) => <li key={j} style={{ listStyle: 'none' }}>{x}</li>)}</ul>}
          </div>
        ))}
      </div>
      {n < m.steps.length ? (
        <button className="btn" style={{ marginTop: 10 }} onClick={reveal}>
          <Icon name="eye" size={18} /> الخطوة التالية من تفكير الكاتبة ({n + 1} من {m.steps.length})
        </button>
      ) : (
        <div className="small muted" style={{ marginTop: 8 }}>اكتملت خطوات التفكير. قارني الآن بين النموذجين أدناه.</div>
      )}
    </section>
  );
}

export function thinkAloudComplete(items: Material[], activityId: string): boolean {
  return items.every((m, i) => {
    if (m.type !== 'thinkAloud') return true;
    try { return Number(localStorage.getItem(`ts-think:${activityId}:${i}`)) >= m.steps.length; } catch { return true; }
  });
}
