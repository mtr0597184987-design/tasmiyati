// يبني الحصص التسع (content/lessons/*.json) من برنامج الكتاب (content/source/program.mjs):
// الكتاب بنصه مهماتٍ في مراحل «تسمياتي» السبع، ونشاط منزلي لكل حصة.
// التشغيل: npm run lessons
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const program = (await import(pathToFileURL(path.join(root, 'content/source/program.mjs')).href + `?t=${Date.now()}`)).default;

const STAGE_DEFAULTS = {
  1: { name: 'رفيقة التحفيز', mode: 'dialogue', support: 'high', motivation: ['C1', 'A1', 'A3'] },
  2: { name: 'مرشدة الاستكشاف', mode: 'dialogue', support: 'high', motivation: ['C4', 'A2', 'R6'] },
  3: { name: 'نموذج الكاتبة', mode: 'modeling', support: 'high', motivation: ['C1', 'A5'] },
  4: { name: 'مستشارة التخطيط', mode: 'dialogue', support: 'medium', motivation: ['A1', 'A2', 'A8', 'R2'] },
  5: { name: 'مدربة الممارسة', mode: 'dialogue', support: 'fading', motivation: ['C2', 'C6', 'R5', 'R8', 'R9'] },
  6: { name: 'حارسة الاستقلال الكتابي', mode: 'disabled', support: 'none', motivation: ['C9', 'A6', 'A8'] },
  7: { name: 'مرشدة التقويم والتحسين', mode: 'evaluation', support: 'low', motivation: ['C7', 'A7', 'R1', 'R3'] },
  H: { name: 'رفيقة النشاط المنزلي', mode: 'dialogue', support: 'low', motivation: ['C5', 'A4', 'R1'] },
};
const STAGE_CONSTRAINTS = {
  1: ['ابدئي مما يعرضه الكتاب في المهمة، واربطيه بخبرة الطالبة، دون أن تقدمي الإجابة قبل محاولتها.'],
  2: ['لا تقدمي القاعدة أو الإجابة مباشرة قبل محاولة الطالبة؛ ساعديها على الاكتشاف بالأسئلة والمقارنة من نص الكتاب.'],
  3: ['اعرضي نموذج الكتاب خطوة خطوة، واشرحي قرارات الكاتب وأسبابها، ثم اسألي الطالبة عما لاحظته.'],
  4: ['لا تختاري للطالبة موضوعها أو أفكارها أو خطتها؛ اطرحي أسئلة إرشادية، والقرار لها.'],
  5: ['قدّمي تغذية راجعة تشخيصية تحدد الموضع والسبب، ولا تكتبي الإجابة أو النص المعدَّل نيابة عن الطالبة.', 'خفّفي المساندة تدريجيًا: سؤال موجه، ثم تلميح أدق، ثم مثال من مجال مختلف.'],
  6: ['المساعد التوليدي معطل برمجيًا في هذه المرحلة؛ يرفض الخادم أي طلب توليد ما دامت الطالبة لم تسلّم.'],
  7: ['لا تعيدي كتابة إنتاج الطالبة ولا تقترحي صياغة بديلة كاملة؛ حددي الموضع واطرحي سؤالًا يوجه التحسين.'],
  H: ['ساعدي الطالبة على التفكير في نشاطها المنزلي بأسئلة موجزة، ولا تنجزيه نيابة عنها.'],
};
const BOOK_CONSTRAINTS = [
  'المحتوى من كتاب الطالبة المقرر (الوحدة التدريبية الرابعة: مهارات الكتابة)؛ اعتمدي على نصه وشروحه، ولا تجيبي عن أنشطته نيابة عن الطالبة.',
  'الكتاب يخاطب المتعلم، والطالبة أنثى؛ خاطبيها بصيغة المؤنث.',
];
const CHECK_MSG = 'افحصي ما كتبته الطالبة في هذا النشاط من الكتاب، واطرحي عليها أسئلة إرشادية تكشف مواضع القوة والتحسين وفق المطلوب في النشاط، دون أن تكتبي الإجابة أو تعدّليها نيابة عنها.';
const STEPS = {
  1: ['اقرئي ما يعرضه الكتاب في هذه المهمة.', 'أجيبي بنفسكِ، وحاوري المساعد إن أردتِ.', 'اضغطي «إكمال المهمة والانتقال».'],
  2: ['اقرئي الشرح أو إطار «اقرئي» في الكتاب.', 'أجيبي عن النشاط لتكتشفي المفهوم بنفسكِ.', 'استعيني بزر «راجعي إجابتي معي» عند الحاجة.'],
  3: ['تابعي نموذج الكتاب خطوة خطوة.', 'لاحظي قرارات الكاتب، واسألي المساعد عما لا يتضح.', 'اكتبي ما لاحظتِه.'],
  4: ['حددي خياراتكِ وخطتكِ بنفسكِ.', 'اسألي المساعد إن أردتِ أسئلة تساعدكِ على التفكير.', 'احفظي خطتكِ ثم انتقلي.'],
  5: ['أجيبي عن نشاطات الكتاب في هذه المهمة.', 'اضغطي «تحقق من إجابتي» حيث يظهر، أو «راجعي إجابتي معي».', 'عدّلي إجابتكِ في ضوء الملاحظات.'],
  6: ['اقرئي نشاط الكتاب جيدًا.', 'أنجزيه بنفسكِ؛ المساعد متوقف في هذه المرحلة.', 'راجعي عملكِ ثم اضغطي «تسليم المهمة».'],
  7: ['قوّمي إنتاجكِ المستقل بالمعايير.', 'اقرئي ملاحظات المساعد.', 'حسّني إنتاجكِ بنفسكِ، ثم قارني بين النسختين.'],
  T: ['هذا اختبار: أجيبي عن كل سؤال بنفسكِ؛ المساعد متوقف هنا.', 'راجعي إجاباتكِ قبل الإنهاء.'],
};

function mediaSrc(src) {
  if (!src.startsWith('book-media/')) return src;
  const f = path.join(root, 'content/source', src);
  return `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(f).toString('base64')}`;
}

function buildSections(task, noAssist) {
  return (task.sections ?? []).map((s, i) => {
    const content = (s.content ?? []).map((it) => (it.type === 'image' ? { ...it, src: mediaSrc(it.src) } : it));
    const sec = { id: `s${i + 1}`, title: s.title, content, fields: s.fields ?? [] };
    if (s.number) sec.number = s.number;
    if (s.supportive) sec.proposed = true;
    if (s.assist && !noAssist) sec.assist = { label: typeof s.assist === 'string' ? s.assist : s.assist.label, message: CHECK_MSG };
    return sec;
  });
}

function buildActivity(L, task, id, isHw) {
  const key = isHw ? 'H' : task.stage;
  const d = STAGE_DEFAULTS[key];
  const test = !!task.test;
  const noAssist = test || key === 6;
  const sections = buildSections(task, noAssist);
  const fields = sections.flatMap((s) => s.fields);
  const mode = test ? 'disabled' : d.mode;
  const a = {
    id, stage: isHw ? 7 : task.stage, title: task.title,
    ...(isHw ? { homework: true } : {}),
    book: { pages: String(task.pages ?? L.pages), part: L.courseTitle, ...(test ? { test: true } : {}) },
    skills: L.skills,
    motivation: test && key !== 6 ? ['C9', 'A6'] : d.motivation,
    studentProcedures: task.steps ?? (test && key !== 6 ? STEPS.T : STEPS[key === 'H' ? 5 : key]),
    materials: [],
    assistant: {
      name: d.name, mode, supportLevel: test ? 'none' : d.support,
      opening: task.opening ?? '',
      questions: (task.questions ?? []).map((q, i) => ({ id: `q${i + 1}`, text: q })),
      constraints: [...STAGE_CONSTRAINTS[key], ...BOOK_CONSTRAINTS, ...(test ? ['هذا اختبار من الكتاب؛ لا مساعدة توليدية فيه.'] : [])],
      ...(key === 6 || test ? { lockMessage: test ? 'هذا اختبار من كتابكِ؛ أجيبي بنفسكِ لتعرفي مستواكِ، ثم ناقشي إجاباتكِ مع معلمتكِ.' : 'ستنجزين هذه المهمة بنفسكِ، ولن أكتب الإجابة أو أقترحها نيابة عنكِ.' } : {}),
    },
    worksheet: { sections },
    requirements: { fields: fields.filter((f) => f.required).map((f) => f.id) },
  };
  if (test && key !== 6) a.completeLabel = 'إنهاء الاختبار';
  if (task.peer) a.peer = { enabled: true, prompt: task.peer.prompt, fields: task.peer.fields };
  if (key === 6) { a.independent = true; a.submitLabel = 'تسليم المهمة'; }
  return a;
}

let total = 0;
for (const L of program) {
  const n = L.number;
  const lesson = {
    id: L.id, number: n, status: 'authored', title: L.title,
    unit: 'كفاية الاتصال الكتابي – مهارات الكتابة', courseLesson: { number: L.course, title: L.courseTitle },
    audience: 'طالبات الصف الأول الثانوي', durationMinutes: 45,
    skills: L.skills, reinforcedSkills: L.reinforced ?? [], integratedSkills: [],
    productLabel: 'المنتج الكتابي', finalOutput: L.product,
    overview: L.overview, objectivesIntro: 'يُتوقع من الطالبة في نهاية الحصة أن:', objectives: L.objectives,
    bookPages: L.pages,
    homeworkTitle: L.homework?.title,
    rubric: {
      header: 'معيار التقويم',
      levels: [{ id: 'met', label: 'متحقق' }, { id: 'needs', label: 'يحتاج إلى تحسين' }],
      criteria: L.rubric.map(([t, skills], i) => ({ id: `c${i + 1}`, text: t, skills, fields: [] })),
    },
    activities: [],
  };
  const tasks = [...L.tasks].sort((a, b) => a.stage - b.stage); // ترتيب ثابت بحسب المرحلة
  let k = 0;
  let indId = null;
  for (const t of tasks) {
    const id = `${n}-${++k}`;
    if (t.stage === 7 && !t.sections) {
      // مهمة التقويم والتحسين: تقويم ذاتي بالمعايير، ثم ملاحظات، ثم نسخة محسنة من الإنتاج المستقل
      const a = buildActivity(L, { ...t, sections: [{ title: 'أقوّم إنتاجي المستقل', content: [{ type: 'p', text: 'قوّمي إنتاجكِ المستقل بمعايير الكتاب الآتية: اختاري أمام كل معيار «متحقق» أو «يحتاج إلى تحسين»، ثم اضغطي «' + L.analyzeLabel + '»، وحسّني إنتاجكِ بنفسكِ.' }], fields: [] }] }, id, false);
      a.evaluation = { sourceActivity: indId, analyzeLabel: L.analyzeLabel };
      a.requirements.selfAssessment = true;
      a.requirements.revised = true;
      lesson.activities.push(a);
      continue;
    }
    const a = buildActivity(L, t, id, false);
    if (a.independent) indId = a.id;
    lesson.activities.push(a);
  }
  if (!indId) throw new Error(`${L.id}: لا توجد مهمة إنتاج مستقل`);
  if (L.homework) {
    const hw = buildActivity(L, { ...L.homework, pages: L.homework.pages ?? L.pages, opening: L.homework.opening ?? `هذا نشاطكِ المنزلي: «${L.homework.title}». أنجزيه بنفسكِ، وإن احتجتِ إلى سؤال يساعدكِ على التفكير فاسأليني.` }, `${n}-H`, true);
    if (!L.homework.book) hw.book.supportive = true;
    lesson.activities.push(hw);
  }
  fs.writeFileSync(path.join(root, `content/lessons/lesson-0${n}.json`), JSON.stringify(lesson, null, 1) + '\n');
  total += lesson.activities.length;
  console.log(`✓ ${L.id} (الدرس ${L.course}): ${L.title} — ${lesson.activities.length} مهمة`);
}
console.log(`المجموع: ${total} مهمة في ${program.length} حصص.`);
