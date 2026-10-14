// الخطوة السابعة: تقويم ذاتي أولًا ← ملاحظات تشخيصية ← تحسين تنفذه الطالبة بنفسها ← مقارنة النسختين.
import { Fragment, useState } from 'react';
import type { Activity, Lesson } from '../../../shared/types';
import { api } from '../api';
import { FieldView } from './Worksheet';
import { parseTable, productText, type ProductFieldLike } from '../../../shared/outline';
import { ProductValue } from './Products';
import { Icon } from '../icons';
import { Alert, fmtDate, useApp } from '../ui';

export function Evaluation({ lesson, activity, data, onRefresh, between }: { lesson: Lesson; activity: Activity; data: any; onRefresh: () => void; between?: React.ReactNode }) {
  const activityId = activity.id;
  const analyze = activity.evaluation?.analyzeLabel;
  const { toast } = useApp();
  const rubric = lesson.rubric!;
  const fields = lesson.productFields ?? [];
  const initial = data.initial;
  const [self, setSelf] = useState<Record<string, { level: string; note: string }>>(data.self ?? {});
  const [selfSaved, setSelfSaved] = useState<boolean>(!!data.selfComplete);
  const [busy, setBusy] = useState('');
  const [fbError, setFbError] = useState<{ msg: string; kind?: string } | null>(null);
  const [revised, setRevised] = useState<Record<string, string>>(data.revised?.data ?? initial?.data ?? {});
  const [revSaved, setRevSaved] = useState<Record<string, string> | null>(data.revised?.data ?? null);

  if (!initial) return <Alert kind="warn">سلّمي إنتاجكِ المستقل أولًا في مرحلة الإنتاج الكتابي المستقل، ثم عودي لتقويمه وتحسينه.</Alert>;

  const allRated = rubric.criteria.every((c) => self[c.id]?.level);
  const step = !selfSaved ? 1 : !revSaved ? 3 : 4;

  async function saveSelf() {
    setBusy('self');
    try {
      const r = await api<{ complete: boolean }>(`/api/activities/${activityId}/self-assessment`, { method: 'PUT', body: { ratings: self } });
      setSelfSaved(r.complete);
      toast(r.complete ? 'حُفظ تقويمكِ الذاتي. انتقلي إلى الملاحظات التشخيصية.' : 'حُفظ ما أنجزتِه. أكملي تقويم بقية المعايير.', 'ok');
      onRefresh();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }
  async function askFeedback() {
    setBusy('fb'); setFbError(null);
    try {
      const r = await api<any>(`/api/activities/${activityId}/feedback`, { body: {} });
      if (r.pendingReview) toast('وصلت الملاحظات، وستظهر لكِ بعد مراجعة المعلمة.', 'info');
      onRefresh();
    } catch (e: any) { setFbError({ msg: e.message, kind: e.data?.kind }); }
    finally { setBusy(''); }
  }
  async function saveRevised() {
    setBusy('rev');
    try {
      const r = await api<any>(`/api/activities/${activityId}/revised`, { method: 'PUT', body: { values: revised } });
      setRevSaved(r.revised.data);
      toast('حُفظت النسخة المحسنة. قارني الآن بين النسختين.', 'ok');
      onRefresh();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }

  const levelLabel = (id: string) => rubric.levels.find((l) => l.id === id)?.label ?? '';
  const changed = fields.filter((f) => revSaved && (revSaved[f.id] ?? '') !== (initial.data[f.id] ?? '')).length;

  return (
    <div className="stack">
      <div className="steps-mini" aria-label="مراحل التقويم">
        {['أقوّم نفسي', 'أفحص الملاحظات', 'أحسّن بنفسي', 'أقارن وأتأمل'].map((s, i) => (
          <span key={s} className={step === i + 1 || (i === 1 && step === 3) ? 'on' : step > i + 1 ? 'done' : ''}>{step > i + 1 ? '✓ ' : ''}{s}</span>
        ))}
      </div>

      <section className="card flat">
        <div className="card-title"><Icon name="pen" /> نسختي الأصلية <span className="tiny muted">(سُلِّمت {fmtDate(initial.meta?.submittedAt)} — محفوظة كما هي)</span></div>
        <dl className="kv">{fields.map((f) => <Fragment key={f.id}><dt>{f.label}</dt><dd><ProductValue type={f.type} field={f} value={initial.data[f.id] ?? ''} /></dd></Fragment>)}</dl>
      </section>

      <section className="card flat">
        <div className="card-title"><span className="lesson-num" style={{ width: 28, height: 28 }}>1</span> أقوّم إنتاجي وفق المعايير</div>
        <div className="table-scroll">
          <table className="grid rubric">
            <thead><tr><th>{rubric.header ?? 'معيار التقويم'}</th>{rubric.levels.map((l) => <th key={l.id} className="lv">{l.label}</th>)}<th>دليلي أو ملاحظتي (اختياري)</th></tr></thead>
            <tbody>
              {rubric.criteria.map((c, i) => (
                <tr key={c.id}>
                  <td style={{ minWidth: 200 }}>{i + 1}. {c.text}</td>
                  {rubric.levels.map((l) => (
                    <td key={l.id} className="lv">
                      <input type="radio" name={`self-${c.id}`} aria-label={`${c.text}: ${l.label}`} checked={self[c.id]?.level === l.id}
                        onChange={() => { setSelf({ ...self, [c.id]: { level: l.id, note: self[c.id]?.note ?? '' } }); setSelfSaved(false); }} />
                    </td>
                  ))}
                  <td style={{ minWidth: 180 }}>
                    <input className="input" value={self[c.id]?.note ?? ''} aria-label={`ملاحظتي على: ${c.text}`} maxLength={600}
                      onChange={(e) => { setSelf({ ...self, [c.id]: { level: self[c.id]?.level ?? '', note: e.target.value } }); setSelfSaved(false); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={saveSelf} disabled={busy === 'self' || !allRated}>{busy === 'self' ? 'جارٍ الحفظ...' : 'حفظ تقويمي الذاتي'}</button>
          {!allRated && <span className="small muted">حددي مستوى لكل معيار.</span>}
          {selfSaved && <span className="badge ok"><Icon name="check" size={13} /> محفوظ</span>}
        </div>
      </section>

      <section className="card flat">
        <div className="card-title"><span className="lesson-num" style={{ width: 28, height: 28 }}>2</span> أفحص الملاحظات التشخيصية</div>
        {!selfSaved ? <p className="muted small">تظهر الملاحظات بعد أن تحفظي تقويمكِ الذاتي؛ فرأيكِ في عملكِ يأتي أولًا.</p> : (
          <>
            {data.feedback.length === 0 && <p className="small muted">لم تصل ملاحظات بعد.</p>}
            {data.feedback.map((f: any) => <FeedbackCard key={f.id} f={f} rubric={rubric} self={self} levelLabel={levelLabel} />)}
            {fbError && <Alert kind={fbError.kind === 'demo' ? 'info' : 'danger'}>{fbError.msg}</Alert>}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={askFeedback} disabled={busy === 'fb'}>
                <Icon name="chat" size={18} /> {busy === 'fb' ? 'يقرأ المساعد إنتاجكِ...' : data.feedback.some((f: any) => f.source === 'ai') ? `${analyze ?? 'اطلبي الملاحظات'} مرة أخرى` : analyze ?? 'اطلبي الملاحظات التشخيصية'}
              </button>
              <span className="tiny muted">الملاحظات الذكية إرشادية، والحكم النهائي لمعلمتكِ.</span>
            </div>
          </>
        )}
      </section>

      {between}
      <section className="card flat">
        <div className="card-title"><span className="lesson-num" style={{ width: 28, height: 28 }}>3</span> أحسّن منتجي بنفسي</div>
        {!selfSaved ? <p className="muted small">تُتاح مساحة التعديل بعد التقويم الذاتي.</p> : (
          <>
            <p className="small muted">عدّلي ما ترين أنه يحتاج إلى تحسين في ضوء المعايير والملاحظات. التعديل قراركِ أنتِ.</p>
            <div className="stack">
              {fields.map((f) => (
                <FieldView key={f.id} field={{ ...f, type: f.type === 'text' || f.type === 'chips' ? 'textarea' : f.type, required: false, defaultValue: undefined, mustChange: false, prefill: undefined }}
                  value={f.type === 'table' ? parseTable(revised[f.id]) : revised[f.id] ?? ''} onChange={(v) => setRevised({ ...revised, [f.id]: v != null && typeof v === 'object' ? JSON.stringify(v) : v })} />
              ))}
            </div>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={saveRevised} disabled={busy === 'rev'}>{busy === 'rev' ? 'جارٍ الحفظ...' : 'حفظ النسخة المحسنة (تبقى الأصلية محفوظة)'}</button>
          </>
        )}
      </section>

      {revSaved && (
        <section className="card flat">
          <div className="card-title"><span className="lesson-num" style={{ width: 28, height: 28 }}>4</span> أقارن بين النسختين</div>
          <p className="small muted">{changed ? `غيّرتِ ${changed} من ${fields.length} عناصر. الإضافات مظللة بالأخضر، والمحذوف بالأحمر.` : 'لم تغيّري شيئًا بعد. إن رأيتِ أن نسختكِ تحقق المعايير فاذكري ذلك في تأملكِ.'}</p>
          <Compare fields={fields} a={initial.data} b={revSaved} />
        </section>
      )}
    </div>
  );
}

function FeedbackCard({ f, rubric, self, levelLabel }: { f: any; rubric: any; self: any; levelLabel: (s: string) => string }) {
  const d = f.data ?? {};
  return (
    <div className="card soft" style={{ marginBottom: 10 }}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <b>{f.source === 'ai' ? 'ملاحظات المساعد التشخيصية' : 'ملاحظات معلمتكِ'}</b>
        <span className={`badge ${f.source === 'ai' ? 'info' : 'primary'}`}>{f.source === 'ai' ? 'ذكاء اصطناعي — تراجعه المعلمة' : 'المعلمة'}</span>
      </div>
      {d.raw && <p style={{ whiteSpace: 'pre-wrap' }}>{d.raw}</p>}
      {d.text && <p style={{ whiteSpace: 'pre-wrap' }}>{d.text}</p>}
      {Array.isArray(d.criteria) && d.criteria.map((c: any) => {
        const cr = rubric.criteria.find((x: any) => x.id === c.id);
        return (
          <div key={c.id} style={{ borderTop: '1px dashed var(--line)', padding: '8px 0' }}>
            <div className="small" style={{ fontWeight: 700 }}>{cr?.text ?? c.id} {self[c.id]?.level && <span className="tiny muted">(تقويمكِ: {levelLabel(self[c.id].level)})</span>}</div>
            {c.observation && <div>{c.observation}</div>}
            {c.where && <div className="small muted">الموضع: «{c.where}»</div>}
            {c.question && <div className="small" style={{ color: 'var(--primary-2)' }}><Icon name="bulb" size={14} style={{ verticalAlign: -2 }} /> {c.question}</div>}
          </div>
        );
      })}
      {d.strength && <p className="small" style={{ margin: '6px 0 0' }}><b>نقطة قوة: </b>{d.strength}</p>}
      {d.nextStep && <p className="small" style={{ margin: 0 }}><b>خطوتكِ التالية: </b>{d.nextStep}</p>}
    </div>
  );
}

// مقارنة على مستوى الكلمات
function diffWords(a: string, b: string) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const n = x.length, m = y.length;
  if (n * m > 250000) return [{ t: 'del', s: a }, { t: 'ins', s: b }];
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: 'eq' | 'del' | 'ins'; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: 'eq', s: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: 'del', s: x[i++] });
    else out.push({ t: 'ins', s: y[j++] });
  }
  while (i < n) out.push({ t: 'del', s: x[i++] });
  while (j < m) out.push({ t: 'ins', s: y[j++] });
  return out;
}

export function Compare({ fields, a: ra, b: rb }: { fields: ProductFieldLike[] & { id: string; label: string }[]; a: Record<string, string>; b: Record<string, string> }) {
  const a: Record<string, string> = {}, b: Record<string, string> = {};
  for (const f of fields as any[]) { a[f.id] = productText(f, ra?.[f.id]); b[f.id] = productText(f, rb?.[f.id]); }
  return (
    <div className="compare">
      <div className="col">
        <h4>النسخة الأصلية</h4>
        {fields.map((f) => <div key={f.id} className="cmp-field"><div className="lbl">{f.label}</div><div className="val" style={{ whiteSpace: 'pre-wrap' }}>{a[f.id] || '—'}</div></div>)}
      </div>
      <div className="col">
        <h4>النسخة المحسنة</h4>
        {fields.map((f) => {
          const same = (a[f.id] ?? '') === (b[f.id] ?? '');
          return (
            <div key={f.id} className={`cmp-field ${same ? '' : 'changed'}`}>
              <div className="lbl">{f.label} {same ? '' : '· عُدِّل'}</div>
              <div className="val">{same ? (b[f.id] || '—') : diffWords(a[f.id] ?? '', b[f.id] ?? '').map((p, i) => p.t === 'eq' ? <span key={i}>{p.s}</span> : p.t === 'ins' ? <ins key={i} className="d">{p.s}</ins> : <del key={i} className="d">{p.s}</del>)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
