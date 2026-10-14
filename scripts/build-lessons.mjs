// يبني ملفات الحصص (content/lessons/*.json) من نص دليل المعلم كما هو (content/source/guide.json)
// ومن مواصفات التفاعل لكل نشاط (content/source/spec-L0N.mjs). النصوص الموجهة للطالبة والإجراءات تُنقل حرفيًا من الدليل.
// التشغيل: node scripts/build-lessons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const guide = JSON.parse(fs.readFileSync(path.join(root, 'content/source/guide.json'), 'utf8'));
const ORD = { 'الأول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4 };

const STAGE_DEFAULTS = {
  1: { name: 'رفيقة التحفيز', mode: 'dialogue', support: 'high', motivation: ['C1', 'A1', 'A3'] },
  2: { name: 'مرشدة الاستكشاف', mode: 'dialogue', support: 'high', motivation: ['C4', 'A2', 'R6'] },
  3: { name: 'نموذج الكاتبة', mode: 'modeling', support: 'high', motivation: ['C1', 'A5'] },
  4: { name: 'مستشارة التخطيط', mode: 'dialogue', support: 'medium', motivation: ['A1', 'A2', 'A8', 'R2'] },
  5: { name: 'مدربة الممارسة', mode: 'dialogue', support: 'fading', motivation: ['C2', 'C6', 'R5', 'R8', 'R9'] },
  6: { name: 'حارسة الاستقلال الكتابي', mode: 'disabled', support: 'none', motivation: ['C9', 'A6', 'A8'] },
  7: { name: 'مرشدة التقويم والتحسين', mode: 'evaluation', support: 'low', motivation: ['C7', 'A7', 'R1', 'R3'] },
  H: { name: 'رفيقة النشاط البيتي', mode: 'dialogue', support: 'low', motivation: ['C5', 'A4', 'R1'] },
};
const STAGE_CONSTRAINTS = {
  1: ['ابدئي من الموقف المعروض في المهمة، واربطيه بخبرة الطالبة، دون أن تقدمي الإجابة قبل محاولتها.'],
  2: ['لا تقدمي القاعدة أو الإجابة مباشرة قبل محاولة الطالبة؛ ساعديها على الاكتشاف بالأسئلة والمقارنة.'],
  3: ['اعرضي النموذج خطوة خطوة، واشرحي قرارات الكاتبة وأسبابها، ثم اسألي الطالبة عما لاحظته.'],
  4: ['لا تختاري للطالبة موضوعها أو أفكارها أو خطتها؛ اطرحي أسئلة إرشادية، والقرار لها.'],
  5: ['قدّمي تغذية راجعة تشخيصية تحدد الموضع والسبب، ولا تكتبي الإجابة أو النص المعدَّل نيابة عن الطالبة.', 'خفّفي المساندة تدريجيًا: سؤال موجه، ثم تلميح أدق، ثم مثال من مجال مختلف.'],
  6: ['المساعد التوليدي معطل برمجيًا في هذه المرحلة؛ يرفض الخادم أي طلب توليد ما دامت الطالبة لم تسلّم.'],
  7: ['لا تعيدي كتابة إنتاج الطالبة ولا تقترحي صياغة بديلة كاملة؛ حددي الموضع واطرحي سؤالًا يوجه التحسين.'],
  H: ['ساعدي الطالبة على التفكير في مهمتها البيتية بأسئلة موجزة، ولا تنجزيها نيابة عنها.'],
};
const CHECK_MSG = 'افحصي ما كتبته الطالبة في هذا النشاط، واطرحي عليها أسئلة إرشادية تكشف مواضع القوة والتحسين وفق المطلوب في النشاط، دون أن تكتبي الإجابة أو تعدّليها نيابة عنها.';

function lessonMeta(g, spec) {
  const h = g.header;
  const [unitOrd, unitTitle] = (h['الوحدة التدريبية'] ?? '').split(/:\s*/);
  const [clOrd, clTitle] = (h['الدرس المقرر'] ?? '').split(/:\s*/);
  const productLabel = h['المنتج الكتابي'] != null ? 'المنتج الكتابي' : h['التطبيق الكتابي'] != null ? 'التطبيق الكتابي' : undefined;
  return {
    id: spec.id, number: g.number, status: 'authored', title: g.title,
    unit: unitTitle ?? unitOrd, courseLesson: { number: ORD[clOrd] ?? 1, title: clTitle ?? '' },
    audience: h['الفئة المستهدفة'] ?? 'طالبات الصف الأول الثانوي',
    durationMinutes: parseInt(h['الزمن'] ?? '45', 10) || 45,
    skills: spec.skills, reinforcedSkills: spec.reinforcedSkills ?? [], integratedSkills: spec.integratedSkills ?? [],
    skillsText: h['مهارات الكتابة'],
    productLabel,
    finalOutput: productLabel ? h[productLabel] : spec.finalOutput,
    overview: g.overview, objectivesIntro: g.objectivesIntro, objectives: g.objectives,
    homeworkTitle: g.homework?.title, homeworkFollowup: g.homework?.followup,
  };
}

function quoteLabels(text) { return [...text.matchAll(/«([^»]+)»/g)].map((m) => m[1]); }

function buildSection(act, s = {}, key) {
  const items = [];
  let tableSeen = 0;
  for (const p of act.parts) {
    if (p.p != null) items.push({ type: 'p', text: p.p });
    else {
      const mode = (Array.isArray(s.table) ? s.table[tableSeen] : s.table) ?? 'display';
      tableSeen++;
      if (mode === 'fields') items.push({ type: 'fields' });
      else if (mode === 'display') items.push({ type: 'table', rows: p.t });
      // 'drop': يعرضه مكوّن آخر (معايير التقويم)
    }
  }
  // مواد إضافية تعرضها المنصة (نصوص النماذج ونحوها) تُدرج قبل الحقول
  if (s.extra?.length) {
    const at = items.findIndex((x) => x.type === 'fields');
    const pos = s.extraAt != null ? s.extraAt : at >= 0 ? at : items.length;
    items.splice(pos, 0, ...s.extra);
  }
  if (s.fieldsAt != null && !items.some((x) => x.type === 'fields')) items.splice(s.fieldsAt, 0, { type: 'fields' });
  if (s.after?.length) {
    if (!items.some((x) => x.type === 'fields')) items.push({ type: 'fields' });
    items.push(...s.after);
  }
  const text = act.parts.filter((p) => p.p).map((p) => p.p).join(' ');
  if (s.assist) {
    const labels = quoteLabels(text);
    if (s.assist.label && !labels.includes(s.assist.label) && !s.assist.free) throw new Error(`${key}: زر «${s.assist.label}» غير وارد في نص النشاط (${labels.join(' | ')})`);
  }
  for (const f of s.fields ?? []) {
    const named = quoteLabels(text).filter((x) => x.startsWith('تحقق'));
    if (f.checkLabel && named.length && !named.includes(f.checkLabel)) throw new Error(`${key}/${f.id}: زر الفحص «${f.checkLabel}» يخالف الوارد في النص (${named.join(' | ')})`);
  }
  const sec = { id: `a${act.n}`, number: act.n, title: act.title, content: items, fields: s.fields ?? [] };
  if (s.fieldsHeading) sec.fieldsHeading = s.fieldsHeading;
  if (s.assist) sec.assist = { label: s.assist.label, message: s.assist.message ?? CHECK_MSG };
  if (s.hints) { sec.hints = s.hints; sec.hintPolicy = s.hintPolicy ?? 'after_attempt'; }
  return sec;
}

function buildActivity(lesson, g, t, spec, isHw) {
  const key = isHw ? 'H' : t.stage;
  const d = STAGE_DEFAULTS[key];
  const ts = spec.tasks[isHw ? 'H' : t.id] ?? {};
  if (!ts.opening) throw new Error(`${isHw ? lesson.id + ' H' : t.id}: لا توجد رسالة افتتاحية`);
  const id = isHw ? `${g.number}-H` : t.id;
  const acts = isHw ? g.homework.tasks : t.acts;
  const sections = acts.map((act) => {
    const s = { ...((ts.acts ?? {})[act.n] ?? {}) };
    if (!isHw && t.stage === 7 && act.n === 1 && s.table == null) s.table = 'drop'; // معايير التقويم يعرضها مكوّن التقويم الذاتي
    const sec = buildSection(act, s, `${id}/${act.n}`);
    if (isHw) { sec.number = undefined; sec.title = `المهمة البيتية ${act.n === 1 ? 'الأولى' : 'الثانية'}: ${act.title}`; }
    return sec;
  });
  const fields = sections.flatMap((s) => s.fields);
  const a = {
    id, stage: isHw ? 7 : t.stage, title: isHw ? g.homework.title : t.title,
    ...(isHw ? { homework: true } : { minutes: t.minutes }),
    skills: ts.skills ?? lesson.skills,
    motivation: ts.motivation ?? d.motivation,
    teacherProcedures: isHw ? g.homework.followup : t.teacher,
    studentProcedures: isHw ? (ts.studentSteps ?? []) : t.student, // النشاط البيتي: خطوات للطالبة مشتقة من نصه (الدليل لا يذكرها)
    materials: [],
    assistant: {
      name: ts.name ?? d.name, mode: d.mode, supportLevel: ts.support ?? d.support,
      opening: ts.opening,
      questions: (ts.questions ?? []).map((q, i) => (typeof q === 'string' ? { id: `q${i + 1}`, text: q } : { id: `q${i + 1}`, ...q })),
      ...(ts.closing ? { closing: ts.closing } : {}),
      constraints: [...STAGE_CONSTRAINTS[key], ...(ts.constraints ?? [])],
      ...(key === 6 ? { lockMessage: 'ستنجزين هذه المهمة بنفسكِ، ولن أكتب الإجابة أو أقترحها نيابة عنكِ.' } : {}),
      ...(ts.quickPrompts ? { quickPrompts: ts.quickPrompts } : {}),
    },
    worksheet: { sections },
    requirements: { fields: ts.requirements ?? fields.filter((f) => f.required).map((f) => f.id) },
  };
  if (ts.showProducts) a.showProducts = ts.showProducts;
  if (ts.peer) a.peer = { enabled: true, prompt: ts.peer.prompt, fields: ts.peer.fields };
  if (ts.completeLabel) a.completeLabel = ts.completeLabel;
  if (!isHw && t.stage === 6) {
    a.independent = true;
    const all = acts.map((x) => x.parts.filter((p) => p.p).map((p) => p.p).join(' ')).join(' ');
    // اسم زر التسليم كما في الدليل؛ وإن لم يُذكر زر فالحفظ «بوصفه إنتاجكِ المستقل»
    a.submitLabel = quoteLabels(all).includes('تسليم المهمة') ? 'تسليم المهمة' : 'حفظ إنتاجي المستقل';
  }
  if (!isHw && t.stage === 7) {
    const txt = acts[0].parts.filter((p) => p.p).map((p) => p.p).join(' ');
    const analyze = quoteLabels(txt).find((x) => x.startsWith('تحليل'));
    if (!analyze) throw new Error(`${id}: لا يوجد زر تحليل في النص`);
    a.evaluation = { sourceActivity: `${g.number}-6`, analyzeLabel: analyze };
    a.requirements.selfAssessment = true;
    a.requirements.revised = true;
  }
  return a;
}

function rubricFrom(g, spec) {
  const t7 = g.tasks.find((t) => t.stage === 7);
  const tbl = t7.acts[0].parts.find((p) => p.t)?.t;
  if (!tbl) throw new Error(`${spec.id}: لا يوجد جدول معايير في المهمة السابعة`);
  const rows = tbl.slice(1).map((r) => r[0]).filter(Boolean);
  if (spec.rubricSkills.length !== rows.length) throw new Error(`${spec.id}: عدد مهارات المعايير ${spec.rubricSkills.length} وعدد المعايير ${rows.length}`);
  return {
    header: tbl[0][0] || 'معيار التقويم',
    levels: [{ id: 'met', label: tbl[0][1] || 'متحقق' }, { id: 'needs', label: tbl[0][2] || 'يحتاج إلى تحسين' }],
    criteria: rows.map((text, i) => ({ id: `c${i + 1}`, text, skills: spec.rubricSkills[i], fields: [] })),
  };
}

const only = process.argv[2];
for (const g of guide) {
  const id = `L0${g.number}`;
  if (only && only !== id) continue;
  const specPath = path.join(root, `content/source/spec-${id}.mjs`);
  if (!fs.existsSync(specPath)) { console.log(`تخطٍّ: ${id} (لا مواصفات بعد)`); continue; }
  const spec = (await import(pathToFileURL(specPath).href + `?t=${Date.now()}`)).default;
  const lesson = lessonMeta(g, spec);
  lesson.rubric = rubricFrom(g, spec);
  lesson.activities = [...g.tasks.map((t) => buildActivity(lesson, g, t, spec, false)), ...(g.homework ? [buildActivity(lesson, g, null, spec, true)] : [])];
  fs.writeFileSync(path.join(root, `content/lessons/lesson-0${g.number}.json`), JSON.stringify(lesson, null, 1) + '\n');
  console.log(`✓ ${id}: ${lesson.title} — ${lesson.activities.length} نشاطًا`);
}
