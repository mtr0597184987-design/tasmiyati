// محرك النشاط: الهدف ← المادة ← التفاعل مع المساعد ← الاستجابة ← التلميح ← الحفظ ← التحقق من المتطلبات ← الانتقال.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Activity, Lesson, Material, WorksheetSection } from '../../../shared/types';
import { api, readDraft, writeDraft } from '../api';
import { Icon } from '../icons';
import { Alert, ErrorBox, Loading, Modal, STAGE_COLORS, fmtDate, useApp } from '../ui';
import { Materials } from './Materials';
import { Worksheet } from './Worksheet';
import { AssistantPanel } from './Assistant';
import { Evaluation } from './Evaluation';
import { PeerCorner } from './Peer';
import { ProductsPanel, prefillValues, type Product } from './Products';
import type { Catalog } from '../pages/Home';

const STAGE_PRAISE: Record<number, string> = {
  1: 'حددتِ هدفكِ الشخصي؛ وهذه أول خطوة للكاتبة الواعية.',
  2: 'وصلتِ إلى الاستنتاج بنفسكِ، وهذا ما يجعله راسخًا.',
  3: 'تابعتِ القرارات خطوة خطوة، وصار تسلسلها واضحًا لكِ.',
  4: 'بطاقة تخطيطكِ جاهزة، وكل قرار فيها قراركِ أنتِ.',
  5: 'تدربتِ وراجعتِ؛ قارني إجاباتكِ الأولى بالأخيرة لتري تقدمكِ.',
  6: 'سلّمتِ إنتاجكِ المستقل بجهدكِ وحدكِ.',
  7: 'قوّمتِ عملكِ وحسّنتِه بنفسكِ؛ هكذا تنمو الكاتبة.',
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'offline' | 'error';

export function ActivityView({ lesson, activity: a, catalog, status, preview, position, onCompleted, prevId, nextId, onNavigate }: {
  lesson: Lesson; activity: Activity; catalog: Catalog; status: string; preview: boolean;
  position: { index: number; total: number; done: number };
  onCompleted: () => Promise<void>; prevId?: string; nextId?: string; onNavigate: (id: string) => void;
}) {
  const { me, aiMode, toast, online } = useApp();
  const stage = catalog.stages.find((s) => s.id === a.stage)!;
  const color = STAGE_COLORS[a.stage];
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [checks, setChecks] = useState<Record<string, any>>({});
  const [hints, setHints] = useState<Record<string, any[]>>({});
  const [revealed, setRevealed] = useState<Material[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [missing, setMissing] = useState<string[]>([]);
  const [pane, setPane] = useState<'work' | 'assistant'>('work');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [inject, setInject] = useState<{ n: number; text: string; section?: string } | null>(null);
  const hasPrefill = a.worksheet.sections.some((s) => s.fields.some((f) => f.prefill?.length));
  useEffect(() => {
    if (preview || (!a.showProducts?.length && !hasPrefill)) return;
    api<{ products: Product[] }>('/api/products').then((r) => setProducts(r.products)).catch(() => setProducts([]));
  }, [a.id]);
  function applyPrefill() {
    if (!products) return;
    const filled = prefillValues(a, products, latest.current);
    const keys = Object.keys(filled);
    if (!keys.length) { toast('لا توجد حقول فارغة يمكن استرجاعها، أو لم تُسلَّم المنتجات السابقة بعد.', 'info'); return; }
    for (const k of keys) onChange(k, filled[k]);
    toast(`استُرجع ${keys.length} من عناصر منتجاتكِ السابقة. راجعيها وعدّليها كما ترين.`, 'ok');
  }
  const paste = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(values);
  latest.current = values;
  const savedVals = useRef<Record<string, any>>({});

  const load = useCallback(async () => {
    if (preview) { setData({ preview: true, values: {}, chat: [] }); return; }
    setError('');
    try {
      const d = await api<any>(`/api/activities/${a.id}`);
      api(`/api/activities/${a.id}/open`, { body: {} }).catch(() => {});
      const draft = readDraft(me.id, a.id);
      const merged = draft?.dirty ? { ...d.values, ...draft.values } : d.values;
      setData(d);
      savedVals.current = d.values ?? {};
      setValues(merged);
      setHints(d.hints ?? {});
      try { paste.current = Number(localStorage.getItem(`ts-paste:${me.id}:${a.id}`)) || 0; } catch { /* */ }
      if (draft?.dirty) { setSaveState('dirty'); scheduleSave(0); }
    } catch (e: any) { setError(e.message); }
  }, [a.id, preview]);
  useEffect(() => { load(); return () => window.clearTimeout(timer.current); }, [load]);

  // إعادة الإرسال عند عودة الاتصال
  useEffect(() => { if (online && (saveState === 'offline' || saveState === 'dirty')) scheduleSave(300); }, [online]);

  async function save(): Promise<boolean> {
    if (preview || data?.initial) return true;
    window.clearTimeout(timer.current);
    const v = latest.current;
    setSaveState('saving');
    try {
      const r = await api<any>(`/api/activities/${a.id}/responses`, { method: 'PUT', body: { values: v } });
      writeDraft(me.id, a.id, { values: v, dirty: latest.current !== v, at: Date.now() });
      savedVals.current = v;
      setChecks((c) => ({ ...c, ...r.checks }));
      if (r.reveal?.length) setRevealed(r.reveal);
      setSaveState(latest.current === v ? 'saved' : 'dirty');
      return true;
    } catch (e: any) {
      setSaveState(e.status === 0 ? 'offline' : 'error');
      if (e.status && e.status !== 0) toast(e.message, 'error');
      return false;
    }
  }
  function scheduleSave(ms = 1200) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, ms);
  }
  function onChange(id: string, v: any) {
    setValues((prev) => {
      const next = { ...prev, [id]: v };
      latest.current = next;
      writeDraft(me.id, a.id, { values: next, dirty: true, at: Date.now() });
      return next;
    });
    setSaveState('dirty');
    setMissing([]);
    if (checks[id]) setChecks((c) => { const n = { ...c }; delete n[id]; return n; });
    setShown((sh) => { if (!sh.has(id)) return sh; const n = new Set(sh); n.delete(id); return n; });
    scheduleSave();
  }
  function onPaste() {
    paste.current += 1;
    try { localStorage.setItem(`ts-paste:${me.id}:${a.id}`, String(paste.current)); } catch { /* */ }
  }

  async function checkNow(fid: string) {
    if (preview) { toast('يظهر الفحص للطالبة بعد الحفظ.', 'info'); return; }
    if (!(await save())) return;
    setShown((sh) => new Set(sh).add(fid));
  }
  async function assistNow(sec: WorksheetSection) {
    if (!sec.assist) return;
    await save();
    setInject({ n: Date.now(), text: `«${sec.assist.label}»`, section: sec.id ?? sec.title });
    setPane('assistant');
  }

  async function complete() {
    setBusy(true);
    try {
      if (!(await save())) { toast('تعذّر حفظ إجاباتكِ على الخادم. هي محفوظة على هذا الجهاز؛ حاولي مرة أخرى عند عودة الاتصال.', 'error'); return; }
      await api(`/api/activities/${a.id}/complete`, { body: {} });
      toast(`${a.homework ? 'أنجزتِ النشاط البيتي، وحُفظ عملكِ.' : STAGE_PRAISE[a.stage]} (أنجزتِ ${position.done + (status === 'completed' ? 0 : 1)} من ${position.total} في هذه الحصة)`, 'ok');
      await onCompleted();
      if (nextId) onNavigate(nextId);
    } catch (e: any) {
      if (e.data?.missing) setMissing(e.data.missing);
      else toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  async function submitIndependent() {
    setBusy(true);
    try {
      await api(`/api/activities/${a.id}/submit`, { body: { values: latest.current, meta: { pasteCount: paste.current } } });
      writeDraft(me.id, a.id, { values: latest.current, dirty: false, at: Date.now() });
      setConfirmSubmit(false);
      toast(STAGE_PRAISE[6] + ' حُفظ إنتاجكِ المستقل مع وقت التسليم.', 'ok');
      await onCompleted();
      await load();
    } catch (e: any) {
      setConfirmSubmit(false);
      if (e.data?.missing) setMissing(e.data.missing); else toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!data) return <Loading />;

  const materials: Material[] = a.materials.map((m) => {
    if (m.type === 'criteria' && m.locked) return revealed.find((r) => r.type === 'criteria' && r.revealAfter === m.revealAfter) ?? m;
    return m;
  });
  const submitted = a.independent && data.initial;
  const previewHints = preview ? Object.fromEntries(a.worksheet.sections.filter((s) => s.hints).map((s) => [s.id ?? s.title, s.hints!])) : hints;
  const skills = a.skills.map((s) => catalog.skills.find((x) => x.id === s)!).filter(Boolean);
  const ORD = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
  const assistOff = aiOff(data, aiMode, a);
  const isRevealed = (fid: string) => { const x = savedVals.current[fid]; return x != null && (typeof x === 'string' ? x.trim().length > 0 : Object.keys(x).length > 0); };
  const wsProps = { preview, isRevealed, activityId: a.id, values, onChange, checks, hints: previewHints, onCheck: checkNow, shownChecks: preview ? undefined : shown, onAssist: assistNow, assistOff };
  const [evalIntro, ...evalRest] = a.worksheet.sections;
  const submitLabel = a.submitLabel ?? 'تسليم المهمة';

  const work = (
    <div className="pane-work">
      <div className="card">
        <header className="activity-header" style={{ ['--c' as any]: color }}>
          <div className="eyebrow">{a.homework ? <>النشاط البيتي{lesson.homeworkTitle ? `: ${lesson.homeworkTitle}` : ''}</> : <>المرحلة {ORD[stage.id]}: {stage.name} · المهمة ({a.id}){a.minutes ? ` · ${a.minutes} ${a.minutes > 10 ? 'دقيقة' : 'دقائق'}` : ''}</>}</div>
          <h2>{a.title}</h2>
          {a.goal && <div className="goal"><b>هدف المهمة: </b>{a.goal}</div>}
          <div className="skill-pills">
            {skills.map((s) => <span key={s.id} className="skill-pill" title={preview ? s.text : undefined}>{s.studentLabel}</span>)}
            {a.expectedOutput && <span className="skill-pill" style={{ background: 'var(--surface-2)' }}><b>المخرج: </b>{a.expectedOutput}</span>}
          </div>
        </header>

        <details className="box" style={{ marginBottom: 14 }}>
          <summary><span><Icon name="list" size={16} /> {a.homework ? 'ماذا سأفعل في النشاط البيتي؟' : 'ماذا سأفعل في هذه المهمة؟'}</span><Icon name="down" size={16} /></summary>
          <div className="body">
            {a.studentProcedures.length > 0 && <><h4 style={{ marginTop: 0 }}>إجراءات التنفيذ المرتبطة بالطالبة</h4><ol style={{ margin: 0 }}>{a.studentProcedures.map((p, i) => <li key={i}>{p}</li>)}</ol></>}
            {a.teacherProcedures && (
              <>
                <h4 style={{ marginTop: 12 }}>{a.homework ? 'متابعة المعلمة وتقويم النشاط البيتي' : 'إجراءات التنفيذ المرتبطة بالمعلمة'}</h4>
                <ol style={{ margin: 0 }}>{a.teacherProcedures.map((p, i) => <li key={i}>{p}</li>)}</ol>
              </>
            )}
          </div>
        </details>

        {a.showProducts?.length && !preview ? <ProductsPanel ids={a.showProducts} products={products} /> : null}
        {preview && a.showProducts?.length ? <div className="small muted" style={{ marginBottom: 10 }}>تُعرض للطالبة هنا منتجاتها من الحصص: {a.showProducts.join('، ')}.</div> : null}
        {materials.length > 0 && <Materials items={materials} activityId={a.id} preview={preview} />}

        {data.teacherNotes?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {data.teacherNotes.map((n: any, i: number) => <Alert key={i} kind="ok" icon="heart"><b>ملاحظة معلمتكِ: </b>{n.note}</Alert>)}
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          {a.evaluation && !preview ? (
            <>
              {evalIntro?.content?.length ? <Worksheet {...wsProps} sections={[evalIntro]} setHints={undefined} hideFields={!evalIntro.fields.length} /> : null}
              <Evaluation lesson={lesson} activity={a} data={data.evaluation} onRefresh={load}
                between={(evalIntro?.content?.length ? evalRest : a.worksheet.sections).length > 0 ? (
                  <Worksheet {...wsProps} sections={evalIntro?.content?.length ? evalRest : a.worksheet.sections} setHints={(s, h) => setHints((x) => ({ ...x, [s]: h }))} />
                ) : null} />
            </>
          ) : submitted ? (
            <div className="stack">
              <Alert kind="ok">سلّمتِ إنتاجكِ المستقل في {fmtDate(data.initial.meta.submittedAt)}. حُفظ كما كتبتِه نسخةً أصلية، ويمكنكِ تحسينه في مرحلة التقويم والتحسين الذكي.</Alert>
              <Worksheet activityId={a.id} sections={a.worksheet.sections} values={data.initial.data} onChange={() => {}} checks={{}} hints={{}} readOnly />
            </div>
          ) : (
            <>
              {a.independent && !preview && (
                <Alert kind="info" icon="pen">هذه مساحة الإنتاج المستقل: اكتبي بنفسكِ، فالمساعد الذكي وأدوات توليد النصوص معطلة. تُحفظ مسودتكِ تلقائيًا، ولا يُعتمد إنتاجكِ إلا عند الضغط على «{submitLabel}».</Alert>
              )}
              <div className="row between" style={{ marginTop: 14 }}>
                <h3 style={{ margin: 0 }}><Icon name="edit" size={18} style={{ verticalAlign: -3 }} /> {a.independent ? 'إنتاجي المستقل' : a.homework ? 'النشاط البيتي' : 'أنشطة المهمة'}</h3>
                {hasPrefill && !preview && <button className="btn sm" onClick={applyPrefill} disabled={!products}><Icon name="folder" size={16} /> استرجاع من منتجاتي السابقة</button>}
              </div>
              <Worksheet {...wsProps} sections={a.worksheet.sections}
                setHints={preview ? undefined : (s, h) => setHints((x) => ({ ...x, [s]: h }))} readOnly={preview} onPaste={a.independent ? onPaste : undefined} />
            </>
          )}
        </div>

        {missing.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <Alert kind="warn"><b>بقي القليل قبل الانتقال:</b><ul style={{ margin: '4px 0 0' }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul></Alert>
          </div>
        )}

        {!preview && (
          <div className="footer-nav">
            <div className="row">
              {prevId && <button className="btn" onClick={() => onNavigate(prevId)}><Icon name="arrowR" size={18} /> السابق</button>}
              <SaveIndicator state={submitted ? 'saved' : saveState} />
            </div>
            <div className="row">
              {!submitted && !a.evaluation && <button className="btn" onClick={save} disabled={saveState === 'saving'}>حفظ</button>}
              {a.independent && !submitted ? (
                <button className="btn accent" onClick={() => setConfirmSubmit(true)} disabled={busy}><Icon name="check" size={18} /> {submitLabel}</button>
              ) : status === 'completed' ? (
                nextId ? <button className="btn primary" onClick={() => { save(); onNavigate(nextId); }}>التالي <Icon name="arrowL" size={18} /></button> : <span className="badge ok">اكتملت الحصة</span>
              ) : (
                <button className="btn primary" onClick={complete} disabled={busy}>{busy ? 'جارٍ التحقق...' : a.completeLabel ?? (nextId ? 'إكمال المهمة والانتقال' : 'إكمال المهمة')} <Icon name="arrowL" size={18} /></button>
              )}
            </div>
          </div>
        )}
      </div>
      {a.peer?.enabled && !preview && <PeerCorner activityId={a.id} prompt={a.peer.prompt} myShares={data.myShares ?? []} />}
    </div>
  );

  const assistant = (
    <div className="pane-assistant side-sticky">
      {preview ? <AssistantConfigPreview a={a} /> : (
        <AssistantPanel activity={a} history={data.chat ?? []} blocked={data.chatBlocked} aiMode={data.ai?.mode ?? aiMode} stageIcon={stage.icon} inject={inject} />
      )}
    </div>
  );

  return (
    <>
      <div className="mobile-switch" role="tablist">
        <button className={`btn sm ${pane === 'work' ? 'primary' : ''}`} onClick={() => setPane('work')} role="tab" aria-selected={pane === 'work'}><Icon name="edit" size={16} /> النشاط</button>
        <button className={`btn sm ${pane === 'assistant' ? 'primary' : ''}`} onClick={() => setPane('assistant')} role="tab" aria-selected={pane === 'assistant'}><Icon name="chat" size={16} /> {a.assistant.name}</button>
      </div>
      <div className="lesson-layout" data-pane={pane}>
        {work}
        {assistant}
      </div>
      {confirmSubmit && (
        <Modal title={submitLabel} onClose={() => setConfirmSubmit(false)}
          footer={<><button className="btn" onClick={() => setConfirmSubmit(false)}>أراجع مرة أخرى</button><button className="btn accent" onClick={submitIndependent} disabled={busy}>نعم، أسلّم</button></>}>
          <p>بعد التسليم يُحفظ إنتاجكِ نسخةً أصلية كما كتبتِه، ولا يمكن تعديله هنا. ستحسّنينه بنفسكِ في مرحلة التقويم والتحسين الذكي مع الاحتفاظ بالنسخة الأصلية.</p>
          <p className="small muted">راجعي عملكِ مرة أخيرة قبل التسليم.</p>
        </Modal>
      )}
    </>
  );
}

function aiOff(data: any, aiMode: string, a: Activity): string | undefined {
  if (a.assistant.mode === 'disabled') return 'المساعد معطل في الإنتاج المستقل.';
  if (data?.chatBlocked) return 'المساعد متوقف حتى تسلّمي إنتاجكِ المستقل في هذه الحصة.';
  if ((data?.ai?.mode ?? aiMode) === 'off') return 'المساعد معطل من إعدادات المعلمة.';
  return undefined;
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, [string, string]> = {
    idle: ['', ''],
    dirty: ['محفوظ على الجهاز — جارٍ الإرسال...', ''],
    saving: ['جارٍ الحفظ...', ''],
    saved: ['✓ محفوظ', ''],
    offline: ['غير متصل — محفوظ على هذا الجهاز، وسيُرسل عند عودة الاتصال', 'offline'],
    error: ['تعذّر الحفظ على الخادم — محفوظ على هذا الجهاز', 'error'],
  };
  const [t, c] = map[state];
  return t ? <span className={`save-state ${c}`} role="status">{t}</span> : null;
}

function AssistantConfigPreview({ a }: { a: Activity }) {
  const as = a.assistant;
  const modes: Record<string, string> = { dialogue: 'حواري', modeling: 'نمذجة', disabled: 'معطل (إنتاج مستقل)', evaluation: 'تقويم وتحسين' };
  const support: Record<string, string> = { high: 'عالية', medium: 'متوسطة', fading: 'متناقصة تدريجيًا', low: 'منخفضة', none: 'لا مساندة' };
  return (
    <aside className="card" aria-label="إعداد المساعد">
      <div className="card-title"><Icon name="settings" /> إعداد المساعد لهذا النشاط</div>
      <dl className="kv">
        <dt>الاسم</dt><dd>{as.name}</dd>
        <dt>الوظيفة</dt><dd>{modes[as.mode]}</dd>
        <dt>المساندة</dt><dd>{support[as.supportLevel]}</dd>
        <dt>مؤشرات الدافعية</dt><dd className="ltr" style={{ textAlign: 'right' }}>{a.motivation.join(' · ')}</dd>
      </dl>
      <h4 style={{ marginTop: 12 }}>الرسالة الافتتاحية</h4>
      <p className="small">{as.opening}</p>
      {as.questions.length > 0 && <><h4>الأسئلة بالتتابع</h4><ol className="small">{as.questions.map((q) => <li key={q.id}>{q.text}{q.hints?.length ? <div className="tiny muted">تلميحات: {q.hints.join(' / ')}</div> : null}</li>)}</ol></>}
      {as.closing && <><h4>الختام</h4><p className="small">{as.closing}</p></>}
      {as.constraints?.length ? <><h4>ضوابط</h4><ul className="small">{as.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></> : null}
      {as.extraInstructions && <><h4>تعليمات المعلمة الإضافية</h4><p className="small">{as.extraInstructions}</p></>}
      <p className="tiny muted">تُعدَّل هذه التعليمات من لوحة المعلمة ← المحتوى.</p>
    </aside>
  );
}
