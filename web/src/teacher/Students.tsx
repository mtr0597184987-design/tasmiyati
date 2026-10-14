import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { Alert, ErrorBox, Loading, fmtDate, useApp, taskNo } from '../ui';

const STATUS_LABEL: Record<string, string> = { completed: 'مكتمل', in_progress: 'قيد الإنجاز', available: 'متاح', locked: 'مقفل' };

export function Students() {
  const { toast } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ count: 5, prefix: 'TS' });
  const [mode, setMode] = useState<'names' | 'count'>('names');
  const [namesText, setNamesText] = useState('');
  const [created, setCreated] = useState<any[]>([]);
  const [lessonId, setLessonId] = useState('');
  const load = () => api('/api/teacher/overview').then((r) => { setD(r); setLessonId((x) => x || r.lessons[0]?.id || ''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const names = namesText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (mode === 'names' && !names.length) { toast('اكتبي اسمًا واحدًا على الأقل.', 'error'); return; }
      const r = await api<any>('/api/teacher/students', { body: mode === 'names' ? { names, prefix: form.prefix } : form });
      setCreated(r.created); setNamesText(''); toast(`أُنشئ ${r.created.length} رمزًا دراسيًا.`, 'ok'); load();
    } catch (err: any) { toast(err.message, 'error'); }
  }

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!d) return <Loading />;
  const lesson = d.lessons.find((l: any) => l.id === lessonId);
  const total = d.students.length;
  const completedAll = lesson ? d.students.filter((s: any) => lesson.activities.every((a: any) => s.progress[lesson.id][a.id] === 'completed')).length : 0;
  const started = lesson ? d.students.filter((s: any) => lesson.activities.some((a: any) => ['completed', 'in_progress'].includes(s.progress[lesson.id][a.id]))).length : 0;

  return (
    <div className="stack">
      <div className="kpis">
        <div className="card kpi"><div className="small muted">الطالبات</div><div className="v">{total}</div></div>
        <div className="card kpi"><div className="small muted">بدأن الحصة</div><div className="v">{started}</div></div>
        <div className="card kpi"><div className="small muted">أكملن الحصة</div><div className="v">{completedAll}</div></div>
        <div className="card kpi"><div className="small muted">بانتظار مراجعتكِ</div><div className="v">{d.pending.shares + d.pending.comments + d.pending.feedbackToReview}</div>
          <div className="tiny muted">{d.pending.shares} مشاركة · {d.pending.comments} تعليق · {d.pending.feedbackToReview} ملاحظة ذكية</div></div>
      </div>

      <section className="card">
        <div className="row between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="users" /> متابعة التقدم في الأنشطة</div>
          <label className="row small">الحصة:
            <select className="input" style={{ width: 'auto', minHeight: 36 }} value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
              {d.lessons.map((l: any) => <option key={l.id} value={l.id}>الحصة {l.number}</option>)}
            </select>
          </label>
        </div>
        {total === 0 ? <p className="muted">لا توجد طالبات بعد. أنشئي رموزًا دراسية من النموذج أدناه.</p> : lesson && (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="grid matrix">
              <thead>
                <tr>
                  <th>الطالبة</th>
                  {lesson.activities.map((a: any) => <th key={a.id} className="cell" title={a.title}>{taskNo(a.id)}</th>)}
                  <th>آخر نشاط</th><th />
                </tr>
              </thead>
              <tbody>
                {d.students.map((s: any) => (
                  <tr key={s.id}>
                    <td className="nowrap"><b>{s.name || s.label}</b><div className="tiny muted" style={{ textAlign: 'right' }}>{s.name ? `${s.label} · ` : ''}<span className="ltr">{s.code}</span></div></td>
                    {lesson.activities.map((a: any) => {
                      const st = s.progress[lesson.id][a.id];
                      return <td key={a.id} className="cell"><span className={`dot ${st}`} title={`${a.title}: ${STATUS_LABEL[st]}`} aria-label={STATUS_LABEL[st]} /></td>;
                    })}
                    <td className="small nowrap">{fmtDate(s.lastActivity) || '—'}</td>
                    <td><button className="btn sm" onClick={() => go(`teacher/student/${s.id}`)}>التفاصيل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row tiny muted" style={{ marginTop: 6 }}>
              <span><span className="dot completed" /> مكتمل</span><span><span className="dot in_progress" /> قيد الإنجاز</span><span><span className="dot available" /> متاح</span><span><span className="dot" /> مقفل</span>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title"><Icon name="plus" /> إضافة طالبات</div>
        <div className="mode-toggle" role="group" aria-label="طريقة الإضافة" style={{ marginBottom: 10 }}>
          <button type="button" aria-pressed={mode === 'names'} onClick={() => setMode('names')}>بالأسماء</button>
          <button type="button" aria-pressed={mode === 'count'} onClick={() => setMode('count')}>رموز مستعارة فقط</button>
        </div>
        {mode === 'names' ? (
          <p className="small muted">اكتبي اسم كل طالبة في سطر مستقل، ويُنشأ لكل اسم رمز دخول. يظهر الاسم لكِ وللطالبة نفسها فقط، ولا يظهر لزميلاتها، ولا يُرسل إلى المساعد الذكي، ولا يدخل في ملفات التصدير إلا إذا اخترتِ ذلك.</p>
        ) : (
          <p className="small muted">يُنشأ لكل طالبة رمز دخول واسم عرض مستعار (طالبة 01...) دون أسماء. احتفظي بجدول الربط بين الرموز والطالبات خارج التطبيق. يمكنكِ إضافة الاسم لاحقًا من صفحة الطالبة.</p>
        )}
        <form className="stack" style={{ gap: 10 }} onSubmit={create}>
          {mode === 'names' && (
            <textarea className="textarea" style={{ minHeight: 140 }} placeholder={'سارة أحمد\nريم خالد\nنور محمد'} value={namesText} onChange={(e) => setNamesText(e.target.value)} aria-label="أسماء الطالبات، اسم في كل سطر" />
          )}
          <div className="row">
            {mode === 'count' && <label className="small">العدد <input className="input" type="number" min={1} max={60} style={{ width: 90 }} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></label>}
            <label className="small">بادئة الرمز <input className="input ltr" style={{ width: 100 }} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} /></label>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }}>
              {mode === 'names' ? `إنشاء الرموز${namesText.trim() ? ` (${namesText.split(/\r?\n/).filter((x) => x.trim()).length})` : ''}` : 'إنشاء'}
            </button>
          </div>
        </form>
        {created.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Alert kind="ok">أُنشئت الرموز التالية. اطبعيها أو انسخيها ووزعيها على الطالبات.</Alert>
            <div className="codes" style={{ marginTop: 10 }}>
              {created.map((c) => <div key={c.code} className="code-card"><div className="small muted">{c.name || c.label}</div><div className="code">{c.code}</div></div>)}
            </div>
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard?.writeText(created.map((c) => `${c.name || c.label}\t${c.code}`).join('\n')); toast('نُسخت الرموز.', 'ok'); }}>نسخ الكل</button>
          </div>
        )}
      </section>
    </div>
  );
}
