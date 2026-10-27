import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { Alert, ErrorBox, Loading, Modal, fmtDate, useApp, taskNo, unitLabel } from '../ui';
import { Compare } from '../activity/Evaluation';
import { Portfolio } from '../pages/Portfolio';
import { RatingCard } from './Ratings';

const ST: Record<string, [string, string]> = { completed: ['مكتمل', 'ok'], in_progress: ['قيد الإنجاز', 'warn'], available: ['متاح', 'primary'], locked: ['مقفل', ''] };

export function StudentDetail({ id }: { id: string }) {
  const { toast } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [chat, setChat] = useState<{ title: string; messages: any[] } | null>(null);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reopen, setReopen] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const load = () => api(`/api/teacher/students/${id}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function act(fn: () => Promise<any>, msg: string) {
    try { await fn(); toast(msg, 'ok'); load(); } catch (e: any) { toast(e.message, 'error'); }
  }

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!d) return <Loading />;
  const s = d.student;

  return (
    <div className="stack">
      <button className="btn ghost sm" onClick={() => go('teacher')}><Icon name="arrowR" size={16} /> كل الطالبات</button>
      <section className="card">
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>{s.name || s.label}</h2>
            <div className="small muted">{s.name ? `${s.label} · ` : ''}الرمز الدراسي: <span className="ltr">{s.code}</span></div>
            {nameEdit === null ? (
              <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => setNameEdit(s.name ?? '')}><Icon name="edit" size={14} /> {s.name ? 'تعديل الاسم' : 'إضافة اسم'}</button>
            ) : (
              <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); const v = nameEdit; setNameEdit(null); act(() => api(`/api/teacher/students/${s.id}`, { method: 'PATCH', body: { name: v } }), 'حُفظ الاسم.'); }}>
                <input className="input" style={{ width: 220 }} autoFocus value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} placeholder="اسم الطالبة" />
                <button className="btn sm primary">حفظ</button>
                <button type="button" className="btn sm" onClick={() => setNameEdit(null)}>إلغاء</button>
              </form>
            )}
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => api(`/api/teacher/students/${s.id}/portfolio`).then(setPortfolio)}><Icon name="folder" size={16} /> ملف الإنجاز</button>
            <button className="btn sm danger" onClick={() => setConfirmDelete(true)}>حذف بياناتها</button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="small row"><input type="checkbox" checked={s.freeNavigation} onChange={(e) => act(() => api(`/api/teacher/students/${s.id}`, { method: 'PATCH', body: { freeNavigation: e.target.checked } }), 'حُدّث إعداد التنقل.')} /> السماح لها بالتنقل الحر بين الأنشطة</label>
        </div>
      </section>

      {d.lessons.map((l: any) => {
        const started = l.activities.some((a: any) => a.status === 'completed' || a.status === 'in_progress');
        if (!started && l.number > 1) return null;
        const evalAct = l.activities.find((a: any) => a.stage === 7 && !a.homework);
        return (
          <section key={l.id} className="card">
            <h3>{unitLabel(l, true)}</h3>

            {l.initial ? (
              <div className="card soft" style={{ marginBottom: 12 }}>
                <div className="row between">
                  <b>المنتج المستقل: النسخة الأصلية والمحسنة {(l.revised ?? l.initial).meta?.approvedAt && <span className="badge ok">معتمد</span>}</b>
                  <button className="btn sm primary" onClick={() => act(() => api(`/api/teacher/students/${s.id}/approve`, { body: { lessonId: l.id, approve: !(l.revised ?? l.initial).meta?.approvedAt } }), (l.revised ?? l.initial).meta?.approvedAt ? 'أُلغي الاعتماد.' : 'اعتُمد المنتج.')}>
                    {(l.revised ?? l.initial).meta?.approvedAt ? 'إلغاء الاعتماد' : `اعتماد ${l.revised ? 'النسخة المحسنة' : 'النسخة الأصلية'}`}
                  </button>
                  <button className="btn sm" onClick={() => setReopen(l.id)}>إعادة فتح التسليم</button>
                </div>
                <div className="tiny muted" style={{ margin: '4px 0 8px' }}>
                  سُلِّمت {fmtDate(l.initial.meta.submittedAt)}
                  {l.initial.meta.openedAt ? ` · مدة العمل التقريبية ${Math.max(1, Math.round((new Date(l.initial.meta.submittedAt).getTime() - new Date(l.initial.meta.openedAt).getTime()) / 60000))} دقيقة` : ''}
                  {` · عمليات لصق في مساحة الإنتاج: ${l.initial.meta.pasteCount ?? 0}`}
                  {' · المساعد التوليدي كان معطلًا أثناء الإنتاج'}
                </div>
                <Compare fields={l.productFields} a={l.initial.data} b={l.revised?.data ?? l.initial.data} />
                {!l.revised && <p className="small muted">لم تحفظ نسخة محسنة بعد.</p>}
              </div>
            ) : <Alert kind="info">لم تسلّم المنتج المستقل لهذه الحصة بعد.</Alert>}

            {evalAct && l.rubric && <EvaluationReview studentId={s.id} activity={evalAct} rubric={l.rubric} onDone={load} />}

            <h4 style={{ marginTop: 14 }}>الأنشطة</h4>
            {l.activities.map((a: any) => (
              <details key={a.id} className="box">
                <summary>
                  <span>{a.homework ? 'النشاط المنزلي: ' : a.book ? `من الكتاب (ص ${a.book.pages}): ` : `(${taskNo(a.id)}) `}{a.title}</span>
                  <span className="row" style={{ gap: 6 }}>
                    {a.unlockedByTeacher && <span className="badge info">فتحته المعلمة</span>}
                    <span className={`badge ${ST[a.status][1]}`}>{ST[a.status][0]}</span>
                  </span>
                </summary>
                <div className="body stack">
                  <div className="tiny muted">فُتح: {fmtDate(a.openedAt) || '—'} · اكتمل: {fmtDate(a.completedAt) || '—'}</div>
                  {a.answers.length ? <dl className="kv">{a.answers.map((x: any) => <div key={x.id} style={{ display: 'contents' }}><dt>{x.label}</dt><dd className="writing">{x.value}</dd></div>)}</dl> : <p className="small muted">لا توجد إجابات محفوظة.</p>}
                  {a.hints.length > 0 && <div className="small">التلميحات المستخدمة: {a.hints.map((h: any) => `${h.section_id} (حتى المستوى ${h.level})`).join('، ')}</div>}
                  {a.notes.map((n: any) => <div key={n.id} className="small card soft" style={{ padding: 8 }}>{n.note} <span className="tiny muted">{n.visible_to_student ? '· تراها الطالبة' : '· خاصة بكِ'}</span> <button className="btn sm ghost" onClick={() => act(() => api(`/api/teacher/notes/${n.id}`, { method: 'DELETE' }), 'حُذفت الملاحظة.')}>حذف</button></div>)}
                  <RatingCard studentId={s.id} activityId={a.id} scale={d.scale} rating={a.rating} />
                  <NoteForm onSave={(note, visible) => act(() => api('/api/teacher/notes', { body: { studentId: s.id, activityId: a.id, note, visibleToStudent: visible } }), 'حُفظت الملاحظة.')} />
                  <div className="row">
                    {a.status === 'locked' && <button className="btn sm" onClick={() => act(() => api(`/api/teacher/students/${s.id}/unlock`, { body: { activityId: a.id } }), 'فُتح النشاط للطالبة.')}><Icon name="lock" size={15} /> فتح النشاط لها (تجاوز المتطلبات)</button>}
                    {a.chatCount > 0 && <button className="btn sm" onClick={() => api<any>(`/api/teacher/students/${s.id}/chat/${a.id}`).then((r) => setChat({ title: `سجل المساعد — ${a.homework ? 'النشاط المنزلي' : `(${taskNo(a.id)})`} ${a.title}`, messages: r.messages }))}><Icon name="chat" size={15} /> سجل المساعد ({a.chatCount})</button>}
                  </div>
                </div>
              </details>
            ))}
          </section>
        );
      })}

      {chat && (
        <Modal title={chat.title} onClose={() => setChat(null)}>
          <Alert kind="info">يُسجَّل اطلاعكِ على هذا السجل. استخدميه عند الحاجة التربوية فقط.</Alert>
          <div className="messages" style={{ marginTop: 10, maxHeight: '60vh' }}>
            {chat.messages.map((m, i) => <div key={i} className={`msg ${m.role} ${m.mode === 'demo' && m.role === 'assistant' ? 'demo' : ''}`}>{m.content}<span className="meta">{fmtDate(m.created_at)} {m.mode === 'demo' ? '· تجريبي' : m.mode === 'ai' ? '· نموذج' : ''}</span></div>)}
          </div>
        </Modal>
      )}
      {portfolio && <Modal title={`ملف إنجاز ${s.name || s.label}`} onClose={() => setPortfolio(null)}><Portfolio data={portfolio} teacherView /></Modal>}
      {reopen && (
        <Modal title="إعادة فتح التسليم" onClose={() => setReopen(null)}
          footer={<><button className="btn" onClick={() => setReopen(null)}>إلغاء</button><button className="btn primary" onClick={() => { const id = reopen; setReopen(null); act(() => api(`/api/teacher/students/${s.id}/reopen-independent`, { body: { lessonId: id } }), 'أُعيد فتح الإنتاج المستقل.'); }}>إعادة الفتح</button></>}>
          <p>ستُعاد إتاحة بطاقة الإنتاج المستقل للطالبة لتسلّمها من جديد. تُحفظ النسخة الحالية في سجل البيانات ولا تُحذف.</p>
        </Modal>
      )}
      {confirmDelete && (
        <Modal title="حذف بيانات الطالبة" onClose={() => setConfirmDelete(false)}
          footer={<><button className="btn" onClick={() => setConfirmDelete(false)}>إلغاء</button><button className="btn danger" onClick={() => api(`/api/teacher/students/${s.id}`, { method: 'DELETE' }).then(() => { toast('حُذفت الطالبة وجميع بياناتها.', 'ok'); go('teacher'); })}>حذف نهائي</button></>}>
          <p>سيُحذف الرمز الدراسي وجميع الإجابات والمنتجات والسجلات المرتبطة به نهائيًا. صدّري البيانات أولًا إن احتجتِ إليها.</p>
        </Modal>
      )}
    </div>
  );
}

function NoteForm({ onSave }: { onSave: (note: string, visible: boolean) => void }) {
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  return (
    <div className="row">
      <input className="input grow" placeholder="ملاحظة للطالبة أو لكِ..." value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> تراها الطالبة</label>
      <button className="btn sm" disabled={!note.trim()} onClick={() => { onSave(note, visible); setNote(''); }}>إضافة ملاحظة</button>
    </div>
  );
}

function EvaluationReview({ studentId, activity, rubric, onDone }: { studentId: number; activity: any; rubric: any; onDone: () => void }) {
  const { toast } = useApp();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const levels = Object.fromEntries(rubric.levels.map((l: any) => [l.id, l.label]));
  const self = activity.selfAssessment ?? {};
  async function send() {
    try {
      await api('/api/teacher/feedback', { body: { studentId, activityId: activity.id, text, criteria: Object.entries(draft).map(([id, observation]) => ({ id, observation })) } });
      toast('أُرسلت ملاحظاتكِ إلى الطالبة.', 'ok'); setDraft({}); setText(''); onDone();
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function toggle(f: any, visible: boolean) {
    try { await api(`/api/teacher/feedback/${f.id}`, { method: 'PATCH', body: { visible } }); onDone(); } catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <div className="card soft" style={{ marginBottom: 12 }}>
      <b>التقويم الذاتي والتغذية الراجعة</b>
      <div className="table-scroll" style={{ marginTop: 8 }}>
        <table className="grid">
          <thead><tr><th>المعيار</th><th>تقويم الطالبة</th><th>ملاحظتكِ على هذا المعيار</th></tr></thead>
          <tbody>
            {rubric.criteria.map((c: any) => (
              <tr key={c.id}>
                <td>{c.text}</td>
                <td className="small">{self[c.id] ? <><b>{levels[self[c.id].level]}</b>{self[c.id].note ? ` — ${self[c.id].note}` : ''}</> : '—'}</td>
                <td><input className="input" value={draft[c.id] ?? ''} onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <textarea className="textarea" style={{ marginTop: 8, minHeight: 60 }} placeholder="ملاحظة عامة للطالبة (اختياري)" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn sm primary" style={{ marginTop: 6 }} onClick={send} disabled={!text.trim() && !Object.values(draft).some((x) => x.trim())}>إرسال ملاحظاتي</button>

      {activity.feedback.length > 0 && <h4 style={{ marginTop: 14 }}>الملاحظات المرسلة</h4>}
      {activity.feedback.map((f: any) => (
        <div key={f.id} className="card flat" style={{ padding: 10, marginBottom: 8 }}>
          <div className="row between">
            <span className="small"><b>{f.source === 'ai' ? 'ملاحظات المساعد الذكي' : 'ملاحظاتكِ'}</b> · {fmtDate(f.created_at)}</span>
            {f.source === 'ai' && (
              <span className="row" style={{ gap: 6 }}>
                {!f.reviewed && <span className="badge warn">لم تُراجع</span>}
                <button className="btn sm" onClick={() => toggle(f, true)} disabled={!!f.visible && !!f.reviewed}>اعتماد وإظهار</button>
                <button className="btn sm" onClick={() => toggle(f, false)} disabled={!f.visible}>إخفاء عن الطالبة</button>
              </span>
            )}
          </div>
          {f.data.raw && <p className="small">{f.data.raw}</p>}
          {f.data.text && <p className="small">{f.data.text}</p>}
          {(f.data.criteria ?? []).map((c: any) => <div key={c.id} className="small">• <b>{rubric.criteria.find((x: any) => x.id === c.id)?.text ?? c.id}</b>: {c.observation} {c.where && <span className="muted">«{c.where}»</span>} {c.question && <em>{c.question}</em>}</div>)}
          {f.data.strength && <div className="small"><b>نقطة قوة:</b> {f.data.strength}</div>}
        </div>
      ))}
    </div>
  );
}
