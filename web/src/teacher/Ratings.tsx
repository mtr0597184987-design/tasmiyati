// سلالم التقدير: تقدّر المعلمة أداء الطالبات في كل نشاط ومهمة. التقدير حكمها وحدها، ولا يملؤه المساعد الذكي.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { Alert, ErrorBox, Loading, Modal, fmtDate, useApp } from '../ui';

export interface ScaleLevel { value: number; label: string }
export interface Criterion { id: string; text: string }

const STATUS: Record<string, [string, string]> = { completed: ['مكتمل', 'ok'], in_progress: ['قيد الإنجاز', 'warn'], available: ['متاح', 'primary'], locked: ['مقفل', ''] };

/** قائمة اختيار مستوى لبند واحد */
export function LevelSelect({ scale, value, onChange, label }: { scale: ScaleLevel[]; value?: number; onChange: (v: number | null) => void; label: string }) {
  return (
    <select className={`input level-select ${value != null ? `lv-${Math.round((value / scale[0].value) * 4)}` : ''}`} aria-label={label}
      value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">—</option>
      {scale.map((l) => <option key={l.value} value={l.value}>{l.value} · {l.label}</option>)}
    </select>
  );
}

/** سلم تقدير طالبة واحدة في نشاط واحد (يُستخدم في صفحة الطالبة) */
export function RatingCard({ studentId, activityId, scale, rating, onSaved }: {
  studentId: number; activityId: string; scale: ScaleLevel[];
  rating: { criteria: Criterion[]; values: Record<string, number>; note: string; updatedAt: string | null };
  onSaved?: () => void;
}) {
  const { toast } = useApp();
  const [values, setValues] = useState<Record<string, number>>(rating.values);
  const [note, setNote] = useState(rating.note);
  const [savedAt, setSavedAt] = useState(rating.updatedAt);
  async function save(v: Record<string, number | null>, n?: string) {
    try {
      const r = await api<any>(`/api/teacher/students/${studentId}/ratings`, { method: 'PUT', body: { activityId, values: v, note: n } });
      setValues(r.values); setSavedAt(r.updatedAt); onSaved?.();
    } catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <div className="card soft rating-card">
      <div className="row between">
        <b className="small"><Icon name="star" size={15} /> سلم التقدير</b>
        <span className="tiny muted">{savedAt ? `حُفظ ${fmtDate(savedAt)}` : 'لم يُقدَّر بعد'}</span>
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        {rating.criteria.map((c) => (
          <div key={c.id} className="rating-row">
            <span className="small">{c.text}</span>
            <LevelSelect scale={scale} label={c.text} value={values[c.id]} onChange={(v) => save({ [c.id]: v })} />
          </div>
        ))}
        <input className="input" placeholder="ملاحظة على الأداء (خاصة بكِ)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== rating.note && save({}, note)} />
      </div>
    </div>
  );
}

export function Ratings() {
  const { toast } = useApp();
  const [catalog, setCatalog] = useState<any[] | null>(null);
  const [lessonId, setLessonId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Criterion[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  useEffect(() => {
    api<any>('/api/teacher/overview').then((r) => {
      setCatalog(r.lessons);
      setLessonId((x) => x || r.lessons[0]?.id || '');
      setActivityId((x) => x || r.lessons[0]?.activities[0]?.id || '');
    }).catch((e) => setError(e.message));
  }, []);

  const load = () => activityId && api<any>(`/api/teacher/ratings/${activityId}`).then((r) => {
    setD(r); setNotes(Object.fromEntries(r.students.map((s: any) => [s.id, s.note])));
  }).catch((e) => setError(e.message));
  useEffect(() => { setD(null); load(); }, [activityId]);

  async function rate(sid: number, values: Record<string, number | null>, note?: string) {
    try {
      const r = await api<any>(`/api/teacher/students/${sid}/ratings`, { method: 'PUT', body: { activityId, values, note } });
      setD((x: any) => ({ ...x, students: x.students.map((s: any) => (s.id === sid ? { ...s, ...r } : s)) }));
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function saveCriteria(list: Criterion[] | null) {
    try {
      if (list) await api(`/api/teacher/activities/${activityId}/scale`, { method: 'PUT', body: { criteria: list } });
      else await api(`/api/teacher/activities/${activityId}/scale`, { method: 'DELETE' });
      toast('حُفظت بنود السلم.', 'ok'); setEditing(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  }

  if (error) return <ErrorBox error={error} retry={() => { setError(''); load(); }} />;
  if (!catalog) return <Loading />;
  const lesson = catalog.find((l) => l.id === lessonId);

  return (
    <div className="stack">
      <section className="card">
        <div className="card-title"><Icon name="star" /> سلالم التقدير</div>
        <p className="small muted">قدّري أداء كل طالبة في كل نشاط وفق بنود مرتبطة بالمهارات المعتمدة. يُحفظ كل اختيار فورًا. التقدير خاص بكِ ولا يظهر للطالبات، ولا يشارك فيه المساعد الذكي. المستويات تُعدَّل من «الإعدادات والتصدير».</p>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="small row">الحصة:
            <select className="input" style={{ width: 'auto', minHeight: 36 }} value={lessonId} onChange={(e) => {
              setLessonId(e.target.value);
              setActivityId(catalog.find((l) => l.id === e.target.value)?.activities[0]?.id ?? '');
            }}>
              {catalog.map((l) => <option key={l.id} value={l.id}>الحصة {l.number}</option>)}
            </select>
          </label>
          <label className="small row grow">النشاط:
            <select className="input" style={{ minHeight: 36 }} value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              {lesson?.activities.map((a: any) => <option key={a.id} value={a.id}>{a.homework ? 'النشاط البيتي: ' : `(${a.id}) `}{a.title}</option>)}
            </select>
          </label>
        </div>
      </section>

      {!d ? <Loading /> : (
        <section className="card">
          <div className="row between">
            <b>({d.activity.id}) {d.activity.title}</b>
            <span className="row" style={{ gap: 6 }}>
              {d.custom && <span className="badge info">بنود معدّلة</span>}
              <button className="btn sm" onClick={() => setEditing(d.criteria.map((c: Criterion) => ({ ...c })))}><Icon name="edit" size={15} /> تعديل بنود السلم</button>
            </span>
          </div>
          <ol className="small" style={{ margin: '8px 0', paddingInlineStart: 22 }}>
            {d.criteria.map((c: Criterion) => <li key={c.id}>{c.text}</li>)}
          </ol>
          {d.students.length === 0 ? <Alert kind="info">لا توجد طالبات بعد.</Alert> : (
            <div className="table-scroll">
              <table className="grid rating-table">
                <thead>
                  <tr>
                    <th>الطالبة</th>
                    <th>الحالة</th>
                    {d.criteria.map((c: Criterion, i: number) => <th key={c.id} title={c.text}>البند {i + 1}</th>)}
                    <th>المتوسط</th>
                    <th>ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {d.students.map((s: any) => {
                    const vals = d.criteria.map((c: Criterion) => s.values[c.id]).filter((v: any) => v != null);
                    const avg = vals.length ? (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1) : '—';
                    return (
                      <tr key={s.id}>
                        <td className="nowrap">
                          <button className="link-btn" onClick={() => go(`teacher/student/${s.id}`)}><b>{s.name || s.label}</b></button>
                          <div className="tiny muted">{s.name ? `${s.label} · ` : ''}<span className="ltr">{s.code}</span></div>
                        </td>
                        <td><span className={`badge ${STATUS[s.status]?.[1] ?? ''}`}>{STATUS[s.status]?.[0] ?? s.status}</span></td>
                        {d.criteria.map((c: Criterion) => (
                          <td key={c.id}><LevelSelect scale={d.scale} label={`${s.name || s.label}: ${c.text}`} value={s.values[c.id]} onChange={(v) => rate(s.id, { [c.id]: v })} /></td>
                        ))}
                        <td className="nowrap"><b>{avg}</b>{vals.length > 0 && <span className="tiny muted"> / {d.scale[0].value}</span>}</td>
                        <td style={{ minWidth: 180 }}>
                          <input className="input" value={notes[s.id] ?? ''} placeholder="ملاحظة"
                            onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                            onBlur={() => (notes[s.id] ?? '') !== s.note && rate(s.id, {}, notes[s.id] ?? '')} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editing && (
        <Modal title="تعديل بنود السلم لهذا النشاط" onClose={() => setEditing(null)}
          footer={<>
            {d?.custom && <button className="btn ghost" onClick={() => saveCriteria(null)}>استعادة البنود الافتراضية</button>}
            <button className="btn" onClick={() => setEditing(null)}>إلغاء</button>
            <button className="btn primary" onClick={() => saveCriteria(editing)}>حفظ</button>
          </>}>
          <p className="small muted">تسري البنود على جميع الطالبات في هذا النشاط. البنود الافتراضية مأخوذة من المهارات المعتمدة للنشاط (أو معايير الحصة في الإنتاج المستقل والتقويم). التقديرات السابقة لبند محذوف لا تظهر بعد الحذف.</p>
          <div className="stack" style={{ gap: 8 }}>
            {editing.map((c, i) => (
              <div key={i} className="row">
                <span className="small muted">{i + 1}.</span>
                <input className="input grow" value={c.text} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <button className="icon-btn" aria-label="حذف البند" onClick={() => setEditing(editing.filter((_, j) => j !== i))}><Icon name="x" /></button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setEditing([...editing, { id: '', text: '' }])}><Icon name="plus" size={15} /> إضافة بند</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
