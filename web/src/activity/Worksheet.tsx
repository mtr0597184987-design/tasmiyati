// ورقة العمل: حقول متنوعة (نص، اختيار، تصنيف، جدول، ترتيب، قائمة)، مع التلميحات المتدرجة والفحص الموضوعي.
import { useState } from 'react';
import { parseOutline, serializeOutline, wordCount, paragraphCount, type OutlineItem } from '../../../shared/outline';
import type { Field, WorksheetSection } from '../../../shared/types';
import { api } from '../api';
import { Icon } from '../icons';
import { useApp } from '../ui';

type Values = Record<string, any>;

export function Worksheet({ activityId, sections, values, onChange, checks, hints, setHints, readOnly, onPaste }: {
  activityId: string;
  sections: (WorksheetSection & { hintCount?: number })[];
  values: Values;
  onChange: (id: string, v: any) => void;
  checks: Record<string, any>;
  hints: Record<string, any[]>;
  setHints?: (sec: string, h: any[]) => void;
  readOnly?: boolean;
  onPaste?: () => void;
}) {
  return (
    <div>
      {sections.map((s) => {
        const sid = s.id ?? s.title;
        return (
          <div key={sid} className="section">
            <div className="section-title">
              <h3 style={{ margin: 0 }}>{s.title}</h3>
              {!readOnly && (s.hintCount ?? 0) > 0 && setHints && (
                <HintButton activityId={activityId} section={sid} total={s.hintCount!} shown={hints[sid]?.length ?? 0} policy={s.hintPolicy} onHints={(h) => setHints(sid, h)} />
              )}
            </div>
            {s.intro && <div className="section-intro" style={{ marginTop: 8 }}>{s.intro}</div>}
            {hints[sid]?.length ? (
              <div className="hint-box" aria-live="polite">
                {hints[sid].map((h: any) => (
                  <div key={h.level} className="hint"><div className="hint-kind">تلميح {h.level}: {h.kind}</div>{h.text}</div>
                ))}
              </div>
            ) : null}
            <div className="stack" style={{ marginTop: 10 }}>
              {s.fields.map((f) => (
                <FieldView key={f.id} field={f} value={values[f.id]} onChange={(v) => onChange(f.id, v)} check={checks[f.id]} readOnly={readOnly} onPaste={onPaste} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HintButton({ activityId, section, total, shown, policy, onHints }: { activityId: string; section: string; total: number; shown: number; policy?: string; onHints: (h: any[]) => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const done = shown >= total;
  async function more() {
    setBusy(true);
    try {
      const r = await api<{ hints: any[] }>(`/api/activities/${activityId}/hint`, { body: { section } });
      onHints(r.hints);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  return (
    <button className="btn sm" onClick={more} disabled={busy || done} title={policy === 'after_attempt' ? 'تُتاح بعد حفظ محاولتكِ الأولى' : undefined}>
      <Icon name="bulb" size={16} />
      {done ? 'استخدمتِ كل التلميحات' : shown ? `تلميح أدق (${shown + 1} من ${total})` : policy === 'after_attempt' ? 'أحتاج إلى تلميح (بعد المحاولة)' : 'أحتاج إلى تلميح'}
    </button>
  );
}

export function FieldView({ field: f, value: rawValue, onChange, check, readOnly, onPaste }: { field: Field; value: any; onChange: (v: any) => void; check?: any; readOnly?: boolean; onPaste?: () => void }) {
  const value = rawValue === undefined || rawValue === null ? f.defaultValue : rawValue;
  const label = <span className="field-label">{f.label}{f.required && <span className="req" aria-label="مطلوب">*</span>}</span>;
  const id = `f-${f.id}`;
  switch (f.type) {
    case 'text':
      return <label className="field" htmlFor={id}>{label}<input id={id} className="input writing" value={value ?? ''} readOnly={readOnly} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} maxLength={600} /></label>;
    case 'textarea':
      return (
        <label className="field" htmlFor={id}>{label}
          <textarea id={id} className={`textarea writing ${f.longText ? 'long' : ''}`} value={value ?? ''} readOnly={readOnly} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} maxLength={f.maxLength ?? 4000} rows={f.longText ? 8 : 3} />
          {(f.minWords || f.minParagraphs || f.longText) && <TextMeter f={f} v={value ?? ''} />}
          {f.mustChange && !readOnly && <span className="field-help">عدّلي النص بنفسكِ؛ لا يُقبل إن بقي كما هو.</span>}
        </label>
      );
    case 'outline':
      return <OutlineField f={f} value={value ?? ''} onChange={onChange} readOnly={readOnly} label={label} onPaste={onPaste} />;
    case 'chips':
      return <ChipsField f={f} value={value} onChange={onChange} readOnly={readOnly} label={label} />;
    case 'choice':
      return (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{f.label}{f.required && <span className="req">*</span>}</legend>
          {(f.options ?? []).map((o) => {
            const oo = typeof o === 'string' ? { id: o, text: o } : o;
            return (
              <label key={oo.id} className="option">
                <input type="radio" name={id} checked={value === oo.id} disabled={readOnly} onChange={() => onChange(oo.id)} />
                <span className="writing">{oo.text}</span>
              </label>
            );
          })}
          {check && <div className={`check ${check.correct ? 'ok' : 'no'}`}>{check.correct ? (f.feedback?.ok ?? 'اختيار مناسب. المهم الآن أن يكون تفسيركِ واضحًا.') : (f.feedback?.no ?? 'راجعي اختياركِ: هل يتصل هذا الهدف بكلمات الموضوع مباشرة؟')}</div>}
        </fieldset>
      );
    case 'classify': {
      const v = (value ?? {}) as Record<string, string>;
      return (
        <div className="field">{label}
          <div className="card flat" style={{ padding: '4px 12px' }}>
            {(f.items ?? []).map((it, idx) => (
              <div key={it.id} className={`classify-row ${check?.detail ? (check.detail[idx] ? 'right' : 'wrong') : ''}`}>
                <span className="txt">{it.text}</span>
                <span className="seg" role="group" aria-label={`تصنيف: ${it.text}`}>
                  {(f.categories ?? []).map((c) => (
                    <button type="button" key={c.id} aria-pressed={v[it.id] === c.id} disabled={readOnly} onClick={() => onChange({ ...v, [it.id]: c.id })}>{c.name}</button>
                  ))}
                </span>
              </div>
            ))}
          </div>
          {check && <div className={`check ${check.correct ? 'ok' : 'no'}`}>{check.correct ? (f.feedback?.ok ?? 'تصنيف دقيق!') : `${check.detail.filter(Boolean).length} من ${check.detail.length} في موضعها. ${f.feedback?.no ?? 'راجعي العبارات المظللة.'}`}</div>}
        </div>
      );
    }
    case 'table': {
      const v = (value ?? {}) as Record<string, Record<string, string>>;
      return (
        <div className="field">{label}
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th />{(f.columns ?? []).map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
              <tbody>
                {(f.rows ?? []).map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="nowrap">{r.label}</th>
                    {(f.columns ?? []).map((c) => (
                      <td key={c.id} style={{ minWidth: 150 }}>
                        <textarea className="textarea writing" rows={2} style={{ minHeight: 56 }} aria-label={`${r.label} — ${c.label}`} readOnly={readOnly}
                          value={v[r.id]?.[c.id] ?? ''} onChange={(e) => onChange({ ...v, [r.id]: { ...(v[r.id] ?? {}), [c.id]: e.target.value } })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    case 'ordering': {
      const items = f.items ?? [];
      const order: string[] = Array.isArray(value) && value.length === items.length ? value : items.map((i) => i.id);
      const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= order.length) return;
        const n = [...order];
        [n[i], n[j]] = [n[j], n[i]];
        onChange(n);
      };
      return (
        <div className="field">{label}
          <ol className="order-list">
            {order.map((id, i) => {
              const it = items.find((x) => x.id === id);
              const st = check?.detail ? (check.detail[i] ? 'right' : 'wrong') : '';
              return (
                <li key={id} className={`order-item ${st}`}>
                  <span className="pos">{i + 1}</span>
                  <span className="grow">{it?.text}</span>
                  {!readOnly && <>
                    <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`تقديم: ${it?.text}`}><Icon name="up" size={18} /></button>
                    <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`تأخير: ${it?.text}`}><Icon name="down" size={18} /></button>
                  </>}
                </li>
              );
            })}
          </ol>
          {check && <div className={`check ${check.correct ? 'ok' : 'no'}`}>{check.correct ? (f.feedback?.ok ?? 'ترتيب دقيق! هذا هو تسلسل قرارات الكاتبة الماهرة.') : `${check.detail.filter(Boolean).length} من ${check.detail.length} في موضعها. ${f.feedback?.no ?? 'راجعي خطوات التفكير، ثم أعيدي الترتيب واحفظي.'}`}</div>}
        </div>
      );
    }
    case 'list': {
      const arr: string[] = Array.isArray(value) && value.length ? value : Array(Math.max(f.min ?? 1, 1)).fill('');
      return (
        <div className="field list-field">{label}
          {arr.map((x, i) => (
            <div key={i} className="item">
              <input className="input writing" value={x} readOnly={readOnly} placeholder={f.placeholder ?? `${i + 1}`} aria-label={`${f.label} ${i + 1}`}
                onChange={(e) => { const n = [...arr]; n[i] = e.target.value; onChange(n); }} onPaste={onPaste} maxLength={500} />
              {!readOnly && arr.length > (f.min ?? 1) && <button type="button" className="icon-btn" aria-label="حذف" onClick={() => onChange(arr.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>}
            </div>
          ))}
          {!readOnly && arr.length < 12 && <button type="button" className="btn sm ghost" onClick={() => onChange([...arr, ''])}><Icon name="plus" size={16} /> إضافة</button>}
        </div>
      );
    }
    default:
      return null;
  }
}

function ChipsField({ f, value, onChange, readOnly, label }: { f: Field; value: any; onChange: (v: any) => void; readOnly?: boolean; label: React.ReactNode }) {
  const opts = (f.options ?? []) as string[];
  const other = !!value && !opts.includes(value);
  const [otherOpen, setOtherOpen] = useState(other);
  return (
    <div className="field">{label}
      <div className="chips" role="group" aria-label={f.label}>
        {opts.map((o) => <button type="button" key={o} className="chip" aria-pressed={value === o} disabled={readOnly} onClick={() => { setOtherOpen(false); onChange(o); }}>{o}</button>)}
        {f.allowOther && <button type="button" className="chip" aria-pressed={otherOpen} disabled={readOnly} onClick={() => { setOtherOpen(true); if (!other) onChange(''); }}>مجال آخر</button>}
      </div>
      {f.allowOther && otherOpen && <input className="input writing" style={{ marginTop: 8 }} placeholder="اكتبي المجال الذي يهمكِ" value={other ? value : ''} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} aria-label="مجال آخر" />}
    </div>
  );
}

function TextMeter({ f, v }: { f: Field; v: string }) {
  const w = wordCount(v), p = paragraphCount(v);
  const okW = !f.minWords || w >= f.minWords, okP = !f.minParagraphs || p >= f.minParagraphs;
  return (
    <span className="meter" aria-live="polite">
      <span className={okW ? 'ok' : ''}>{w} كلمة{f.minWords ? ` (الحد الأدنى ${f.minWords})` : ''}</span>
      {f.minParagraphs ? <span className={okP ? 'ok' : ''}>{p} فقرة (الحد الأدنى {f.minParagraphs}؛ افصلي بين الفقرات بسطر)</span> : null}
    </span>
  );
}

// محرر المخطط: أفكار رئيسة قابلة للترتيب، وتحت كل منها تفصيلات
function OutlineField({ f, value, onChange, readOnly, label, onPaste }: { f: Field; value: string; onChange: (v: string) => void; readOnly?: boolean; label: React.ReactNode; onPaste?: () => void }) {
  const parsed = parseOutline(value);
  const items: OutlineItem[] = parsed.length ? parsed : Array.from({ length: Math.max(1, f.min ?? 1) }, () => ({ idea: '', details: [''] }));
  const set = (next: OutlineItem[]) => onChange(serializeOutline(next));
  const upd = (i: number, patch: Partial<OutlineItem>) => set(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; set(n); };
  const ok = items.filter((i) => i.idea.trim()).length >= (f.min ?? 1);
  if (readOnly) {
    return (
      <div className="field">{label}
        <ol className="outline-view">{items.map((it, i) => <li key={i}><b>{it.idea}</b>{it.details.filter(Boolean).length > 0 && <ul>{it.details.filter(Boolean).map((d, k) => <li key={k}>{d}</li>)}</ul>}</li>)}</ol>
      </div>
    );
  }
  return (
    <div className="field">{label}
      <span className="field-help">أفكار رئيسة ({f.min ?? 1} على الأقل){f.minDetails ? `، وتحت كل فكرة ${f.minDetails === 1 ? 'تفصيل واحد' : f.minDetails + ' تفصيلات'} على الأقل` : ''}. رتّبي الأفكار بالسهمين.</span>
      <ol className="outline-edit">
        {items.map((it, i) => (
          <li key={i} className="outline-idea">
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span className="pos">{i + 1}</span>
              <input className="input writing grow" value={it.idea} placeholder="فكرة رئيسة" aria-label={`الفكرة الرئيسة ${i + 1}`} onChange={(e) => upd(i, { idea: e.target.value.replace(/\n/g, ' ') })} onPaste={onPaste} />
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`تقديم الفكرة ${i + 1}`}><Icon name="up" size={17} /></button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`تأخير الفكرة ${i + 1}`}><Icon name="down" size={17} /></button>
              {items.length > 1 && <button type="button" className="icon-btn" onClick={() => set(items.filter((_, j) => j !== i))} aria-label={`حذف الفكرة ${i + 1}`}><Icon name="x" size={17} /></button>}
            </div>
            <div className="outline-details">
              {(it.details.length ? it.details : ['']).map((d, k) => (
                <div key={k} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <span className="muted">–</span>
                  <input className="input writing grow" value={d} placeholder="تفصيل أو معلومة أو مثال" aria-label={`تفصيل ${k + 1} للفكرة ${i + 1}`}
                    onChange={(e) => { const ds = [...(it.details.length ? it.details : [''])]; ds[k] = e.target.value.replace(/\n/g, ' '); upd(i, { details: ds }); }} onPaste={onPaste} />
                  {it.details.length > 1 && <button type="button" className="icon-btn" onClick={() => upd(i, { details: it.details.filter((_, j) => j !== k) })} aria-label="حذف التفصيل"><Icon name="x" size={15} /></button>}
                </div>
              ))}
              <button type="button" className="btn sm ghost" onClick={() => upd(i, { details: [...(it.details.length ? it.details : ['']), ''] })}><Icon name="plus" size={14} /> تفصيل</button>
            </div>
          </li>
        ))}
      </ol>
      {items.length < 10 && <button type="button" className="btn sm" onClick={() => set([...items, { idea: '', details: [''] }])}><Icon name="plus" size={16} /> فكرة رئيسة</button>}
      {!ok && <span className="field-help">اكتبي {f.min ?? 1} أفكار رئيسة على الأقل.</span>}
    </div>
  );
}
