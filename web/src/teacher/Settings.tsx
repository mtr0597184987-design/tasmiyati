import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { Alert, ErrorBox, Loading, Modal, downloadUrl, fmtDate, useApp } from '../ui';

const DEFAULT_MODELS: Record<string, string> = { anthropic: 'claude-sonnet-5-5', gemini: 'gemini-3.8-flash', openai: 'gpt-5' };

export function Settings() {
  const { toast } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<any>({});
  const [key, setKey] = useState('');
  const [test, setTest] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [scale, setScale] = useState<string[]>([]);
  const [names, setNames] = useState(false);
  const [reset, setReset] = useState<null | 'work' | 'all'>(null);
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const load = () => api('/api/teacher/settings').then((r: any) => { setD(r); setAi(r.ai); setScale(r.scale.map((x: any) => x.label)); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function saveAi() {
    try {
      const r = await api<any>('/api/teacher/settings', { method: 'PUT', body: { ai: { ...ai, apiKey: key || undefined } } });
      setD(r); setAi(r.ai); setKey(''); toast('حُفظت إعدادات النموذج. أعيدي تحميل الصفحة ليظهر الوضع الجديد.', 'ok');
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function saveApp(k: string, v: boolean) {
    try { const r = await api<any>('/api/teacher/settings', { method: 'PUT', body: { app: { [k]: v } } }); setD(r); }
    catch (e: any) { toast(e.message, 'error'); }
  }
  async function saveScale(v: string[] | null) {
    try { const r = await api<any>('/api/teacher/settings', { method: 'PUT', body: { scale: v } }); setD(r); setScale(r.scale.map((x: any) => x.label)); toast('حُفظت مستويات السلم.', 'ok'); }
    catch (e: any) { toast(e.message, 'error'); }
  }
  async function doReset() {
    try {
      await api('/api/teacher/reset', { body: { mode: reset, ...resetForm } });
      toast(reset === 'all' ? 'حُذفت جميع الطالبات وبياناتهن.' : 'صُفّر عمل جميع الطالبات.', 'ok');
      setReset(null); setResetForm({ password: '', confirm: '' });
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function runTest() {
    setTesting(true); setTest(null);
    try { setTest(await api('/api/teacher/ai/test', { body: {} })); } catch (e: any) { setTest({ ok: false, error: e.message }); }
    finally { setTesting(false); }
  }

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!d) return <Loading />;
  const toggles: [string, string, string][] = [
    ['freeNavigation', 'التنقل الحر لجميع الطالبات', 'يسمح بفتح أي نشاط دون استيفاء متطلبات النشاط السابق. الأصل: معطل.'],
    ['peerComments', 'تعليقات الزميلات على الأعمال المعروضة', 'تظهر التعليقات بعد موافقتكِ.'],
    ['aiFeedbackVisibleImmediately', 'إظهار الملاحظات الذكية للطالبة فور وصولها', 'عند تعطيله لا تظهر الملاحظات إلا بعد اعتمادكِ لها من صفحة الطالبة.'],
    ['showTeacherProcedures', 'إظهار إجراءات المعلمة للطالبات', 'الأصل: تُعرض إجراءات الطالبة فقط.'],
  ];

  return (
    <div className="stack">
      {d.storage && (
        <section className="card">
          <div className="card-title"><Icon name="folder" /> حفظ البيانات</div>
          {d.storage.mode === 'turso' ? (
            <Alert kind={d.storage.lastError && d.storage.pending ? 'warn' : 'ok'}>
              البيانات محفوظة في قاعدة بيانات سحابية دائمة (Turso)، فلا تضيع عند توقف الخادم أو إعادة تشغيله.
              {d.storage.lastSyncAt && <> آخر مزامنة: {fmtDate(d.storage.lastSyncAt)}.</>}
              {d.storage.pending > 0 && <> عمليات بانتظار الإرسال: {d.storage.pending}.</>}
              {d.storage.lastError && d.storage.pending > 0 && <div className="small">{d.storage.lastError}</div>}
            </Alert>
          ) : (
            <Alert kind="info">البيانات محفوظة على قرص الخادم. تأكدي أن الاستضافة توفر قرصًا دائمًا، وصدّري نسخة احتياطية دوريًا.</Alert>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-title"><Icon name="chat" /> ربط المساعد بنموذج الذكاء الاصطناعي</div>
        <Alert kind={d.ai.keyConfigured && d.ai.enabled ? 'ok' : 'warn'}>
          {d.ai.keyConfigured && d.ai.enabled
            ? <>المساعد متصل عبر الخادم بالمزود <b>{d.ai.provider === 'openai' && /openrouter\.ai/.test(d.ai.baseUrl ?? '') ? 'OpenRouter' : (({ anthropic: 'Anthropic (Claude)', gemini: 'Google Gemini', openai: 'OpenAI' } as any)[d.ai.provider] ?? d.ai.provider)}</b> والنموذج <b className="ltr">{d.ai.model}</b>. المفتاح محفوظ في الخادم فقط ({d.ai.keySource === 'env' ? 'من متغير البيئة' : 'من الإعدادات'}، ينتهي بـ <span className="ltr">{d.ai.keyHint}</span>).</>
            : d.ai.enabled ? 'لم يُضبط مفتاح API بعد؛ يعمل المساعد في «وضع تجريبي غير متصل بالنموذج» يعرض تسلسل الأسئلة فقط ولا يقيّم الإجابات.' : 'المساعد معطل.'}
        </Alert>
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <label className="field"><span className="field-label">المزود</span>
            <select className="input" value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value, model: DEFAULT_MODELS[e.target.value] })}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">واجهة متوافقة مع OpenAI</option>
            </select>
          </label>
          <label className="field"><span className="field-label">اسم النموذج</span><input className="input ltr" value={ai.model ?? ''} onChange={(e) => setAi({ ...ai, model: e.target.value })} /></label>
          {ai.provider === 'openai' && <label className="field grow"><span className="field-label">عنوان الخدمة</span><input className="input ltr" value={ai.baseUrl ?? ''} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} /></label>}
          <label className="field"><span className="field-label">الحد الأقصى لطول الرد</span><input className="input" type="number" min={100} max={4000} style={{ width: 120 }} value={ai.maxTokens ?? 700} onChange={(e) => setAi({ ...ai, maxTokens: Number(e.target.value) })} /></label>
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field-label">مفتاح API {d.ai.keyConfigured && <span className="tiny muted">(مضبوط — اتركيه فارغًا للإبقاء عليه)</span>}</span>
          <input className="input ltr" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai.provider === 'gemini' ? 'AIza...' : 'sk-...'} />
          <span className="field-help">
            يُرسل إلى الخادم ويُحفظ فيه، ولا يعود إلى المتصفح أبدًا. يمكن بدلًا من ذلك ضبطه بمتغير البيئة {ai.provider === 'gemini' ? 'GEMINI_API_KEY' : ai.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}.
            {ai.provider === 'gemini' && <> يُنشأ مفتاح Gemini من Google AI Studio (aistudio.google.com).</>}
          </span>
        </label>
        <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={!!ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} /> تفعيل المساعد الذكي</label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={saveAi}>حفظ إعدادات النموذج</button>
          <button className="btn" onClick={runTest} disabled={testing}>{testing ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}</button>
          {d.ai.keySource === 'settings' && <button className="btn ghost" onClick={() => api('/api/teacher/settings', { method: 'PUT', body: { ai: { clearKey: true } } }).then(load)}>حذف المفتاح المحفوظ</button>}
        </div>
        {test && <div style={{ marginTop: 10 }}><Alert kind={test.ok ? 'ok' : 'danger'}>{test.ok ? <>نجح الاتصال ({test.ms} ملّي ثانية). رد النموذج: «{test.reply}»</> : test.error}</Alert></div>}
        {ai.provider === 'gemini' && (
          <div style={{ marginTop: 10 }}><Alert kind="warn">
            شروط Gemini API تشترط أن يكون المستخدم 18 عامًا فأكثر، ولا تجيز استخدامه في خدمة موجهة لمن هم دون 18 أو يُرجّح أن يستخدموها. وفي الفئة المجانية قد تُستخدم المدخلات لتحسين منتجات Google ويطّلع عليها مراجعون بشريون.
            مناسب لفترة التحكيم مع محكّمين بالغين. قبل التطبيق مع الطالبات راجعي الشروط وموافقة جهتكِ التعليمية، أو بدّلي المزود من هذه القائمة.
          </Alert></div>
        )}
        <p className="tiny muted" style={{ marginTop: 10 }}>تنبيه: قد يكون المستخدمون دون الثامنة عشرة. تحققي من شروط مزود النموذج وسياسات مؤسستكِ التعليمية قبل التفعيل، ومن إعدادات المزود الخاصة بعدم استخدام البيانات في التدريب.</p>
      </section>

      <section className="card">
        <div className="card-title"><Icon name="settings" /> إعدادات التعلم والصلاحيات</div>
        <div className="stack">
          {toggles.map(([k, label, help]) => (
            <label key={k} className="row" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" style={{ marginTop: 7 }} checked={!!d.app[k]} onChange={(e) => saveApp(k, e.target.checked)} />
              <span><b>{label}</b><div className="small muted">{help}</div></span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title"><Icon name="star" /> مستويات سلالم التقدير</div>
        <p className="small muted">تُستخدم هذه المستويات في تقدير جميع الأنشطة. الأعلى أولًا، وتأخذ الدرجات من {scale.length} إلى 1. أما بنود كل نشاط فتُعدَّل من تبويب «سلالم التقدير».</p>
        <div className="stack" style={{ gap: 6, maxWidth: 420 }}>
          {scale.map((l, i) => (
            <div key={i} className="row">
              <span className="badge" style={{ minWidth: 34, justifyContent: 'center' }}>{scale.length - i}</span>
              <input className="input grow" value={l} onChange={(e) => setScale(scale.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="icon-btn" aria-label="حذف المستوى" disabled={scale.length <= 2} onClick={() => setScale(scale.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" disabled={scale.length >= 6} onClick={() => setScale([...scale, ''])}><Icon name="plus" size={15} /> إضافة مستوى</button>
          <button className="btn sm primary" onClick={() => saveScale(scale)}>حفظ المستويات</button>
          <button className="btn sm ghost" onClick={() => saveScale(null)}>استعادة الافتراضي</button>
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>تغيير عدد المستويات بعد بدء التقدير قد يغيّر معنى الدرجات المحفوظة؛ يُفضّل ضبطه قبل البدء.</p>
      </section>

      <section className="card">
        <div className="card-title"><Icon name="download" /> تصدير البيانات</div>
        <p className="small muted">بيانات أداء ومنتجات وتقديرات بالمعرفات المستعارة. لا تُعد قياسًا للدافعية.</p>
        <label className="row small" style={{ marginBottom: 8 }}><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> تضمين أسماء الطالبات في الملفات (الأصل: دون أسماء، وهو الأنسب للتحليل البحثي)</label>
        <div className="row">
          <button className="btn" onClick={() => downloadUrl(`/api/teacher/export.csv${names ? '?names=1' : ''}`)}>تنزيل الإجابات CSV (يفتح في Excel)</button>
          <button className="btn" onClick={() => downloadUrl(`/api/teacher/export-ratings.csv${names ? '?names=1' : ''}`)}>تنزيل تقديرات المعلمة CSV</button>
          <button className="btn" onClick={() => downloadUrl(`/api/teacher/export.json${names ? '?names=1' : ''}`)}>تنزيل JSON كامل</button>
        </div>
      </section>

      <section className="card danger-zone">
        <div className="card-title" style={{ color: 'var(--danger)' }}><Icon name="alert" /> التصفير</div>
        <p className="small muted">يفيد بعد فترة التجريب أو التحكيم، لبدء التطبيق الفعلي ببيانات نظيفة. المحتوى التعليمي والإعدادات وتعديلاتكِ على الحصص وسلالم التقدير لا تتأثر. <b>لا يمكن التراجع عن التصفير؛ نزّلي نسخة JSON أولًا.</b></p>
        <div className="row">
          <button className="btn danger" onClick={() => setReset('work')}>تصفير عمل الطالبات</button>
          <button className="btn danger" onClick={() => setReset('all')}>حذف جميع الطالبات</button>
        </div>
        <ul className="small muted" style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
          <li><b>تصفير عمل الطالبات:</b> تبقى الرموز والأسماء، وتُمحى الإجابات والمنتجات والمحادثات والملاحظات والتقديرات والمشاركات، فتبدأ كل طالبة من الحصة الأولى.</li>
          <li><b>حذف جميع الطالبات:</b> تُحذف الرموز والأسماء وكل بياناتهن، وتُنشئين رموزًا جديدة.</li>
        </ul>
      </section>

      <section className="card">
        <div className="card-title"><Icon name="lock" /> تغيير كلمة مرور المعلمة</div>
        <div className="row">
          <input className="input" type="password" placeholder="كلمة المرور الحالية" style={{ width: 220 }} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input className="input" type="password" placeholder="الجديدة (8 محارف على الأقل)" style={{ width: 240 }} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <button className="btn" onClick={() => api('/api/teacher/password', { body: pw }).then(() => { toast('تغيرت كلمة المرور.', 'ok'); setPw({ current: '', next: '' }); }).catch((e) => toast(e.message, 'error'))}>تغيير</button>
        </div>
      </section>
      {reset && (
        <Modal title={reset === 'all' ? 'حذف جميع الطالبات' : 'تصفير عمل الطالبات'} onClose={() => setReset(null)}
          footer={<>
            <button className="btn" onClick={() => setReset(null)}>إلغاء</button>
            <button className="btn danger" disabled={resetForm.confirm.trim() !== 'تصفير' || !resetForm.password} onClick={doReset}>تنفيذ نهائي</button>
          </>}>
          <Alert kind="danger">
            {reset === 'all'
              ? `ستُحذف ${'جميع الطالبات'} ورموزهن وأسماؤهن وكل بياناتهن نهائيًا.`
              : 'ستُمحى إجابات جميع الطالبات ومنتجاتهن ومحادثاتهن والملاحظات والتقديرات والمشاركات نهائيًا، وتبقى الرموز والأسماء.'}
            {' '}لا يمكن التراجع.
          </Alert>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => downloadUrl('/api/teacher/export.json?names=1')}><Icon name="download" size={15} /> تنزيل نسخة احتياطية أولًا</button>
          </div>
          <label className="field" style={{ marginTop: 10 }}><span className="field-label">كلمة مرور المعلمة</span>
            <input className="input" type="password" autoComplete="current-password" value={resetForm.password} onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })} /></label>
          <label className="field" style={{ marginTop: 8 }}><span className="field-label">اكتبي كلمة «تصفير» للتأكيد</span>
            <input className="input" value={resetForm.confirm} onChange={(e) => setResetForm({ ...resetForm, confirm: e.target.value })} /></label>
        </Modal>
      )}
    </div>
  );
}
