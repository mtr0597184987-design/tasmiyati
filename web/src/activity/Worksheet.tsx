// ورقة العمل: حقول متنوعة (نص، اختيار، تصنيف، جدول، ترتيب، قائمة)، مع التلميحات المتدرجة والفحص الموضوعي.
import { useState } from 'react';
import { parseOutline, parseTable, serializeOutline, wordCount, paragraphCount, type OutlineItem } from '../../../shared/outline';
import type { Field, SectionItem, WorksheetSection } from '../../../shared/types';
import { Materials } from './Materials';
import { PlannerField, PlannerView } from './Planner';
import { api } from '../api';
import { Icon } from '../icons';
import { useApp } from '../ui';

type Values = Record<string, any>;

export function Worksheet({ activityId, sections, values, onChange, checks, hints, setHints, readOnly, onPaste, onCheck, shownChecks, onAssist, assistOff, hideFields, isRevealed, preview }: {
  isRevealed?: (fieldId: string) => boolean; // التغذية الراجعة النموذجية تُكشف بعد حفظ محاولة الطالبة
  preview?: boolean;
  activityId: string;
  sections: (WorksheetSection & { hintCount?: number })[];
  values: Values;
  onChange: (id: string, v: any) => void;
  checks: Record<string, any>;
  hints: Record<string, any[]>;
  setHints?: (sec: string, h: any[]) => void;
  readOnly?: boolean;
  onPaste?: () => void;
  onCheck?: (fieldId: string) => void; // زر «تحقق من إجابتي»
  shownChecks?: Set<string>; // الحقول التي طلبت الطالبة فحصها
  onAssist?: (s: WorksheetSection) => void; // أزرار المساعد المسماة في الدليل
  assistOff?: string; // سبب تعطيل أزرار المساعد
  hideFields?: boolean;
}) {
  return (
    <div>
      {sections.map((s) => {
        const sid = s.id ?? s.title;
        const fields = hideFields ? null : (
          <div className="stack" style={{ marginTop: 10 }}>
            {s.fieldsHeading && <h4 style={{ margin: 0 }}>{s.fieldsHeading}</h4>}
            {s.fields.map((f) => {
              const canCheck = !!(f.checkable || f.answerKey != null);
              const ch = shownChecks ? (shownChecks.has(f.id) ? checks[f.id] : undefined) : checks[f.id];
              return (
                <div key={f.id}>
                  <FieldView field={f} value={values[f.id]} onChange={(v) => onChange(f.id, v)} check={ch} readOnly={readOnly} onPaste={onPaste} />
                  {f.help && !readOnly && <span className="field-help" style={{ display: 'block', marginTop: 4 }}>{f.help}</span>}
                  {preview && f.answerKey != null && <div className="tiny" style={{ marginTop: 6, color: 'var(--primary-2)' }}><b>الإجابة المعتمدة (للمعلمة): </b>{answerText(f)}</div>}
                  {canCheck && onCheck && !readOnly && (
                    <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => onCheck(f.id)}><Icon name="check" size={16} /> {f.checkLabel ?? 'تحقق من إجابتي'}</button>
                  )}
                </div>
              );
            })}
          </div>
        );
        const items = s.content ?? [];
        const hasSlot = items.some((it) => it.type === 'fields');
        return (
          <div key={sid} className="section">
            <div className="section-title">
              <h3 style={{ margin: 0 }}>{s.number ? <span className="act-num">نشاط ({s.number})</span> : null}{s.title}</h3>
              {!readOnly && (s.hintCount ?? 0) > 0 && setHints && (
                <HintButton activityId={activityId} section={sid} total={s.hintCount!} shown={hints[sid]?.length ?? 0} policy={s.hintPolicy} onHints={(h) => setHints(sid, h)} />
              )}
            </div>
            {s.intro && <div className="section-intro" style={{ marginTop: 8 }}>{s.intro}</div>}
            {items.map((it, i) => <SectionItemView key={i} item={it} activityId={activityId} fields={fields} isRevealed={isRevealed} preview={preview} />)}
            {hints[sid]?.length ? (
              <div className="hint-box" aria-live="polite">
                {hints[sid].map((h: any) => (
                  <div key={h.level} className="hint"><div className="hint-kind">تلميح {h.level}: {h.kind}</div>{h.text}</div>
                ))}
              </div>
            ) : null}
            {!hasSlot && fields}
            {s.assist && onAssist && !readOnly && (
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn assist-btn" disabled={!!assistOff} title={assistOff} onClick={() => onAssist(s)}><Icon name="chat" size={17} /> {s.assist.label}</button>
                {assistOff && <span className="tiny muted">{assistOff}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function answerText(f: Field): string {
  const k: any = f.answerKey;
  const opt = (id: string) => { const o = (f.options ?? []).find((x) => (typeof x === 'string' ? x : x.id) === id); return typeof o === 'string' ? o : o?.text ?? id; };
  if (f.type === 'choice' || f.type === 'select') return opt(k);
  if (f.type === 'multi') return (k as string[]).map(opt).join('، ');
  if (f.type === 'ordering') return (k as string[]).map((id) => f.items?.find((i) => i.id === id)?.text).join(' ← ');
  if (f.type === 'classify') return (f.items ?? []).map((i) => `${i.text}: ${f.categories?.find((c) => c.id === k[i.id])?.name}`).join(' | ');
  return '';
}

function SectionItemView({ item: it, activityId, fields, isRevealed, preview }: { item: SectionItem; activityId: string; fields: React.ReactNode; isRevealed?: (f: string) => boolean; preview?: boolean }) {
  switch (it.type) {
    case 'p': return <p className="act-text">{it.text}</p>;
    case 'table': return <DisplayTable rows={it.rows} />;
    case 'material': {
      const m = it.material;
      if (m.type === 'criteria' && m.revealAfter && !preview && !(isRevealed?.(m.revealAfter) ?? true)) {
        return <div className="locked-box" style={{ margin: '10px 0' }}><Icon name="lock" size={18} style={{ verticalAlign: -4 }} /> {m.title}: تظهر بعد أن تكتبي إجابتكِ وتحفظيها.</div>;
      }
      return <div style={{ margin: '10px 0' }}><Materials items={[m]} activityId={`${activityId}:${m.title}`} preview={preview} /></div>;
    }
    case 'diagram': return <div className="diagram-box">{it.title && <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>{it.title}</div>}<PlannerView value={{ ...it.value, mode: it.mode }} /></div>;
    case 'box': {
      const L = it.ordered ? 'ol' : 'ul';
      return (
        <div className={`book-box ${it.tone === 'plain' ? 'plain' : ''}`}>
          {it.title && <div className="book-box-title">{it.title}</div>}
          <L>{it.items.map((x, i) => x.startsWith('– ') ? <li key={i} className="sub">{x.slice(2)}</li> : <li key={i}>{x}</li>)}</L>
        </div>
      );
    }
    case 'passage':
      return (
        <figure className="passage">
          {it.title && <figcaption className="passage-title">{it.title}</figcaption>}
          {it.text.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
          {it.source && <div className="passage-source">{it.source}</div>}
        </figure>
      );
    case 'image':
      return <figure className="book-image"><img src={it.src} alt={it.alt} />{it.caption && <figcaption>{it.caption}</figcaption>}</figure>;
    case 'fields': return <>{fields}</>;
    default: return null;
  }
}

export function DisplayTable({ rows }: { rows: string[][] }) {
  if (!rows.length) return null;
  const [head, ...body] = rows;
  return (
    <div className="table-scroll" style={{ margin: '10px 0' }}>
      <table className="grid display">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} style={{ whiteSpace: 'pre-line' }}>{c}</td>)}</tr>)}</tbody>
      </table>
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
          {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'إجابة مناسبة.'} no={f.feedback?.no ?? 'راجعي اختياركِ، ثم حاولي مرة أخرى.'} />}
        </fieldset>
      );
    case 'select': {
      const opts = (f.options ?? []).map((o) => (typeof o === 'string' ? { id: o, text: o } : o));
      return (
        <label className="field" htmlFor={id}>{label}
          <select id={id} className="input" value={value ?? ''} disabled={readOnly} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">اختاري من القائمة</option>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
          {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'اختيار مناسب.'} no={f.feedback?.no ?? 'راجعي اختياركِ.'} />}
        </label>
      );
    }
    case 'multi': {
      const arr: string[] = Array.isArray(value) ? value : [];
      const opts = (f.options ?? []).map((o) => (typeof o === 'string' ? { id: o, text: o } : o));
      return (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">{f.label}{f.required && <span className="req">*</span>}</legend>
          {f.max ? <span className="field-help">اختاري {f.max === 1 ? 'بديلًا واحدًا' : f.max === 2 ? 'بديلين' : `${f.max} بدائل`}.</span> : null}
          {opts.map((o) => {
            const on = arr.includes(o.id);
            return (
              <label key={o.id} className="option">
                <input type="checkbox" checked={on} disabled={readOnly || (!on && !!f.max && arr.length >= f.max)} onChange={() => onChange(on ? arr.filter((x) => x !== o.id) : [...arr, o.id])} />
                <span className="writing">{o.text}</span>
              </label>
            );
          })}
          {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'اختيار دقيق.'} no={f.feedback?.no ?? 'راجعي اختياراتكِ.'} />}
        </fieldset>
      );
    }
    case 'planner':
      return <PlannerField f={f} value={value} onChange={onChange} readOnly={readOnly} label={label} />;
    case 'classify': {
      const v = (value ?? {}) as Record<string, string>;
      if (f.display === 'select') {
        return (
          <div className="field">{label}
            <div className="table-scroll">
              <table className="grid match">
                {f.rowHeader && <thead><tr><th>{f.rowHeader}</th><th>{f.placeholder ?? ''}</th></tr></thead>}
                <tbody>
                  {(f.items ?? []).map((it, idx) => (
                    <tr key={it.id} className={check?.detail ? (check.detail[idx] ? 'right' : 'wrong') : ''}>
                      <td>{it.text}</td>
                      <td style={{ minWidth: 150 }}>
                        <select className="input" aria-label={it.text} value={v[it.id] ?? ''} disabled={readOnly} onChange={(e) => onChange({ ...v, [it.id]: e.target.value })}>
                          <option value="">اختاري من القائمة</option>
                          {(f.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'مطابقة دقيقة!'} no={`${check.detail.filter(Boolean).length} من ${check.detail.length} صحيحة. ${f.feedback?.no ?? 'راجعي الصفوف المظللة.'}`} />}
          </div>
        );
      }
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
          {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'تصنيف دقيق!'} no={`${check.detail.filter(Boolean).length} من ${check.detail.length} في موضعها. ${f.feedback?.no ?? 'راجعي العبارات المظللة.'}`} />}
        </div>
      );
    }
    case 'table': {
      const v = parseTable(value) as Record<string, Record<string, string>>;
      return (
        <div className="field">{label}
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>{f.rowHeader ?? ''}</th>{(f.columns ?? []).map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
              <tbody>
                {(f.rows ?? []).map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.label}</th>
                    {(f.columns ?? []).map((c) => {
                      const given = f.given?.[r.id]?.[c.id];
                      if (given != null) return <td key={c.id} className="given" style={{ whiteSpace: 'pre-line' }}>{given}</td>;
                      const opts = r.options ?? c.options;
                      const set = (x: string) => onChange({ ...v, [r.id]: { ...(v[r.id] ?? {}), [c.id]: x } });
                      return (
                        <td key={c.id} style={{ minWidth: 150 }}>
                          {opts ? (
                            <select className="input" aria-label={`${r.label} — ${c.label}`} disabled={readOnly} value={v[r.id]?.[c.id] ?? ''} onChange={(e) => set(e.target.value)}>
                              <option value="">اختاري من القائمة</option>
                              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <textarea className="textarea writing" rows={2} style={{ minHeight: 56 }} aria-label={`${r.label} — ${c.label}`} readOnly={readOnly} placeholder="أكتب هنا"
                              value={v[r.id]?.[c.id] ?? ''} onChange={(e) => set(e.target.value)} onPaste={onPaste} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'اختيارات دقيقة!'} no={`${check.detail.filter(Boolean).length} من ${check.detail.length} صحيحة. ${f.feedback?.no ?? 'راجعي اختياراتكِ.'}`} />}
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
          {check && <CheckMsg check={check} ok={f.feedback?.ok ?? 'ترتيب دقيق!'} no={`${check.detail.filter(Boolean).length} من ${check.detail.length} في موضعها. ${f.feedback?.no ?? 'راجعي الترتيب، ثم حاولي مرة أخرى.'}`} />}
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

function CheckMsg({ check, ok, no }: { check: any; ok: string; no: string }) {
  return <div className={`check ${check.correct ? 'ok' : 'no'}`} role="status">{check.message ?? (check.correct ? ok : no)}</div>;
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
