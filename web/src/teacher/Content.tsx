// مراجعة المحتوى قبل نشره، وإتاحة الحصص، وتعديل تعليمات المساعد لكل نشاط ومعايير التقويم دون تعديل الشيفرة.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { href } from '../router';
import { Alert, ErrorBox, Loading, Modal, useApp } from '../ui';

export function Content() {
  const { toast } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [rubric, setRubric] = useState<any>(null);
  const load = () => api('/api/teacher/content').then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function setState(id: string, body: any, msg: string) {
    try { await api(`/api/teacher/lessons/${id}`, { method: 'PATCH', body }); toast(msg, 'ok'); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  }

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!d) return <Loading />;
  const v = d.validation;
  return (
    <div className="stack">
      {v.errors.length ? <Alert kind="danger"><b>أخطاء في ملفات المحتوى:</b><ul>{v.errors.map((e: string) => <li key={e}>{e}</li>)}</ul></Alert>
        : <Alert kind="ok">المحتوى متوافق مع البنية المعتمدة: سبع خطوات مرتبة، و18 مهارة، و26 مؤشرًا للدافعية، وتسع حصص. الحصص المسودة: {v.warnings.length}.</Alert>}

      {d.lessons.map((l: any) => (
        <section key={l.id} className="card">
          <div className="row between">
            <div>
              <h3 style={{ margin: 0 }}>الحصة {l.number}: {l.title}</h3>
              <div className="small muted">الدرس المقرر {l.courseLesson.number}: {l.courseLesson.title} · المهارات: {l.skills.join('، ')}{l.reinforcedSkills.length ? ` · تعزيز: ${l.reinforcedSkills.join('، ')}` : ''}{l.integratedSkills?.length ? ` · تكامل: ${l.integratedSkills.join('، ')}` : ''}</div>
            </div>
            <div className="row">
              {l.status === 'draft' ? <span className="badge">مسودة — لم يُعدّ محتواها</span> : (
                <>
                  <a className="btn sm" href={href(`lesson/${l.id}`)}><Icon name="eye" size={16} /> معاينة كما تراها الطالبة</a>
                  {l.reviewedAt ? <span className="badge ok">رُوجعت</span> : <button className="btn sm" onClick={() => setState(l.id, { reviewed: true }, 'اعتُمد محتوى الحصة.')}>اعتماد المحتوى بعد المراجعة</button>}
                  <label className="row small" style={{ gap: 4 }}>
                    <input type="checkbox" checked={l.enabled} onChange={(e) => setState(l.id, { enabled: e.target.checked }, e.target.checked ? 'أُتيحت الحصة للطالبات.' : 'أُوقفت إتاحة الحصة.')} />
                    متاحة للطالبات
                  </label>
                </>
              )}
            </div>
          </div>
          {l.status === 'draft' && <p className="small muted" style={{ margin: '8px 0 0' }}>{l.authoringNote}</p>}
          {l.activities.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 10 }}>
              <table className="grid">
                <thead><tr><th>النشاط</th><th>الخطوة</th><th>المساعد</th><th>المهارات</th><th>الدافعية</th><th /></tr></thead>
                <tbody>
                  {l.activities.map((a: any) => (
                    <tr key={a.id}>
                      <td>({a.id}) {a.title}</td>
                      <td className="small">{a.stage}</td>
                      <td className="small">{a.assistant.name}{l.overridden.includes(a.id) && <span className="badge info" style={{ marginInlineStart: 4 }}>معدّل</span>}</td>
                      <td className="small">{a.skills.join('، ')}</td>
                      <td className="small ltr" style={{ textAlign: 'right' }}>{a.motivation.join(' ')}</td>
                      <td><button className="btn sm" onClick={() => setEdit({ lesson: l, activity: a })} disabled={a.assistant.mode === 'disabled'}>تعليمات المساعد</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {l.rubric && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setRubric(l)}>معايير التقويم {l.rubricOverridden && '(معدّلة)'}</button>}
        </section>
      ))}

      <section className="card soft">
        <div className="card-title"><Icon name="info" /> مؤشرات الدافعية المعتمدة</div>
        <p className="small muted">يدعم المساعد هذه المؤشرات بأسلوب التفاعل، ولا تتحول إلى أسئلة اختبار. لا يعني إكمال النشاط تحققها؛ فقياسها يتم بأداة البحث المستقلة.</p>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {d.motivation.map((dim: any) => (
            <div key={dim.id} className="grow" style={{ minWidth: 240 }}>
              <h4>{dim.name}</h4>
              <ol className="small">{dim.indicators.map((i: any) => <li key={i.id}><span className="ltr">{i.id}</span> — {i.text}</li>)}</ol>
            </div>
          ))}
        </div>
      </section>

      {edit && <AssistantEditor ctx={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {rubric && <RubricEditor lesson={rubric} onClose={() => setRubric(null)} onSaved={() => { setRubric(null); load(); }} />}
    </div>
  );
}

function AssistantEditor({ ctx, onClose, onSaved }: { ctx: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const a = ctx.activity.assistant;
  const [f, setF] = useState({
    name: a.name, opening: a.opening, closing: a.closing ?? '', extraInstructions: a.extraInstructions ?? '',
    questions: a.questions.map((q: any) => q.text).join('\n'), constraints: (a.constraints ?? []).join('\n'),
  });
  async function save() {
    try {
      await api(`/api/teacher/activities/${ctx.activity.id}/assistant`, { method: 'PUT', body: {
        name: f.name, opening: f.opening, closing: f.closing, extraInstructions: f.extraInstructions,
        questions: f.questions.split('\n').map((t, i) => ({ id: a.questions[i]?.id ?? `q${i + 1}`, text: t.trim() })).filter((q) => q.text),
        constraints: f.constraints.split('\n').map((x) => x.trim()).filter(Boolean),
      } });
      toast('حُفظت تعليمات المساعد لهذا النشاط.', 'ok'); onSaved();
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function reset() {
    await api(`/api/teacher/activities/${ctx.activity.id}/assistant`, { method: 'DELETE' });
    toast('أُعيدت التعليمات الأصلية من ملف المحتوى.', 'ok'); onSaved();
  }
  const T = (k: keyof typeof f, label: string, rows = 3, help?: string) => (
    <label className="field"><span className="field-label">{label}</span><textarea className="textarea" rows={rows} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{help && <span className="field-help">{help}</span>}</label>
  );
  return (
    <Modal title={`تعليمات المساعد — النشاط (${ctx.activity.id})`} onClose={onClose}
      footer={<><button className="btn" onClick={reset}>استعادة الأصل</button><button className="btn primary" onClick={save}>حفظ</button></>}>
      <div className="stack">
        <Alert kind="info">تُدمج هذه التعليمات تلقائيًا مع القواعد الإلزامية للمساعد وبيانات النشاط (الخطوة، والهدف، والمهارات، ومؤشرات الدافعية). التلميحات المرتبطة بكل سؤال تبقى كما في ملف المحتوى.</Alert>
        <label className="field"><span className="field-label">اسم المساعد في النشاط</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        {T('opening', 'الرسالة الافتتاحية')}
        {T('questions', 'الأسئلة بالتتابع (سؤال في كل سطر)', 6)}
        {T('closing', 'رسالة الختام')}
        {T('constraints', 'ضوابط خاصة بالنشاط (ضابط في كل سطر)', 4)}
        {T('extraInstructions', 'تعليمات إضافية من المعلمة', 3, 'مثال: ركّزي على أمثلة من البيئة المحلية للطالبات.')}
      </div>
    </Modal>
  );
}

function RubricEditor({ lesson, onClose, onSaved }: { lesson: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [items, setItems] = useState<any[]>(lesson.rubric.criteria);
  async function save() {
    try { await api(`/api/teacher/lessons/${lesson.id}/rubric`, { method: 'PUT', body: { criteria: items } }); toast('حُفظت معايير التقويم.', 'ok'); onSaved(); }
    catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <Modal title={`معايير التقويم — الحصة ${lesson.number}`} onClose={onClose}
      footer={<><button className="btn" onClick={async () => { await api(`/api/teacher/lessons/${lesson.id}/rubric`, { method: 'DELETE' }); onSaved(); }}>استعادة الأصل</button><button className="btn primary" onClick={save}>حفظ</button></>}>
      <p className="small muted">مستويات التقويم: {lesson.rubric.levels.map((l: any) => l.label).join(' · ')}. تظهر المعايير للطالبة في الإنتاج المستقل والتقويم الذاتي، ويستند إليها المساعد في ملاحظاته.</p>
      <div className="stack">
        {items.map((c, i) => (
          <div key={c.id} className="row">
            <span className="lesson-num" style={{ width: 28, height: 28 }}>{i + 1}</span>
            <input className="input grow" value={c.text} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <button className="icon-btn" aria-label="حذف" onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>
          </div>
        ))}
        <button className="btn sm ghost" onClick={() => setItems([...items, { id: `c${Date.now() % 100000}`, text: '' }])}><Icon name="plus" size={16} /> إضافة معيار</button>
      </div>
    </Modal>
  );
}
