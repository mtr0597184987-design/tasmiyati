// تحميل المحتوى التعليمي من ملفات JSON (منفصلًا عن الشيفرة)، ودمج تعديلات المعلمة المحفوظة في قاعدة البيانات.
import fs from 'node:fs';
import path from 'node:path';
import type { Activity, Lesson, MotivationDimension, Rubric, Skill, StrategyStage, Field } from '../shared/types.ts';
import { all, get, parse } from './db.ts';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve(process.cwd(), 'content');

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, rel), 'utf8')) as T;
}

let cache: {
  stages: StrategyStage[];
  skills: Skill[];
  domains: { id: string; name: string }[];
  motivation: MotivationDimension[];
  rules: string[];
  style: string;
  lessons: Lesson[];
} | null = null;

export function loadContent(force = false) {
  if (cache && !force) return cache;
  const strategy = readJson<{ stages: StrategyStage[] }>('strategy.json');
  const skills = readJson<{ skills: Skill[]; domains: { id: string; name: string }[] }>('skills.json');
  const motivation = readJson<{ dimensions: MotivationDimension[] }>('motivation.json');
  const rules = readJson<{ rules: string[]; style: string }>('assistant-rules.json');
  const files = fs.readdirSync(path.join(CONTENT_DIR, 'lessons')).filter((f) => f.endsWith('.json')).sort();
  const lessons = files.map((f) => readJson<Lesson>(path.join('lessons', f))).sort((a, b) => a.number - b.number);
  cache = {
    stages: strategy.stages,
    skills: skills.skills,
    domains: skills.domains,
    motivation: motivation.dimensions,
    rules: rules.rules,
    style: rules.style,
    lessons,
  };
  return cache;
}

/** الحقول التي يحق للمعلمة تعديلها في تعليمات المساعد لكل نشاط */
export const EDITABLE_ASSISTANT_KEYS = ['name', 'opening', 'closing', 'extraInstructions', 'questions', 'constraints'] as const;

function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** حصة بعد دمج تعديلات المعلمة (تعليمات المساعد ومعايير التقويم) */
export function getLesson(id: string): Lesson | undefined {
  const base = loadContent().lessons.find((l) => l.id === id);
  if (!base) return undefined;
  const lesson = deepClone(base);
  // حقول المنتج = حقول نشاط الإنتاج المستقل نفسها (بأنواعها وقيودها)
  const ind = lesson.activities.find((a) => a.independent);
  if (ind) lesson.productFields = activityFields(ind).map((f) => ({ ...f }));
  const rub = get('SELECT data FROM overrides WHERE target = ?', `rubric:${lesson.id}`);
  if (rub && lesson.rubric) lesson.rubric = { ...lesson.rubric, ...parse<Partial<Rubric>>(rub.data, {}) };
  const ovs = all("SELECT target, data FROM overrides WHERE target LIKE 'activity:%'");
  const map = new Map(ovs.map((o) => [o.target.slice(9), parse<any>(o.data, {})]));
  for (const a of lesson.activities) {
    const ov = map.get(a.id);
    if (ov?.assistant) {
      for (const k of EDITABLE_ASSISTANT_KEYS) if (ov.assistant[k] !== undefined) (a.assistant as any)[k] = ov.assistant[k];
    }
  }
  return lesson;
}

export function allLessons(): Lesson[] {
  return loadContent().lessons.map((l) => getLesson(l.id)!);
}

export function findActivity(activityId: string): { lesson: Lesson; activity: Activity; index: number } | undefined {
  for (const l of allLessons()) {
    const index = l.activities.findIndex((a) => a.id === activityId);
    if (index >= 0) return { lesson: l, activity: l.activities[index], index };
  }
  return undefined;
}

export function activityFields(a: Activity): Field[] {
  return a.worksheet.sections.flatMap((s) => s.fields);
}

/** نسخة الطالبة: تُحذف مفاتيح الإجابة، وإجراءات المعلمة، والمواد التي لا تُكشف إلا بعد محاولة الطالبة */
export function lessonForStudent(lesson: Lesson, revealed: Set<string>, showTeacherProcedures: boolean): Lesson {
  const l = deepClone(lesson);
  for (const a of l.activities) {
    if (!showTeacherProcedures) delete a.teacherProcedures;
    for (const s of a.worksheet.sections) for (const f of s.fields) delete f.answerKey;
    a.materials = a.materials.map((m) => {
      if (m.type === 'criteria' && m.fromRubric && l.rubric) {
        return { ...m, items: l.rubric.criteria.map((c, i) => ({ label: String(i + 1), text: c.text })) };
      }
      if (m.type === 'criteria' && m.revealAfter && !revealed.has(`${a.id}:${m.revealAfter}`)) {
        return { type: 'criteria', title: m.title, revealAfter: m.revealAfter, locked: true };
      }
      return m;
    });
    // لا تُرسَل تعليمات المساعد الداخلية إلى الطالبة؛ يكفي ما يلزم لعرض الواجهة
    a.assistant = {
      name: a.assistant.name,
      mode: a.assistant.mode,
      supportLevel: a.assistant.supportLevel,
      opening: a.assistant.opening,
      showMaterialsAfterOpening: a.assistant.showMaterialsAfterOpening,
      questions: a.assistant.questions.map((q) => ({ id: q.id, text: q.text })),
      closing: a.assistant.closing,
      lockMessage: a.assistant.lockMessage,
      quickPrompts: a.assistant.quickPrompts,
    };
  }
  return l;
}

export function skillText(id: number) {
  return loadContent().skills.find((s) => s.id === id)?.text ?? '';
}
export function indicatorText(id: string) {
  for (const d of loadContent().motivation) {
    const i = d.indicators.find((x) => x.id === id);
    if (i) return `${d.name}: ${i.text}`;
  }
  return id;
}

/** التحقق من التزام المحتوى بالاستراتيجية (يُستخدم في سكربت validate وعند تشغيل الخادم) */
export function validateContent(): { errors: string[]; warnings: string[] } {
  const c = loadContent(true);
  const errors: string[] = [];
  const warnings: string[] = [];
  const skillIds = new Set(c.skills.map((s) => s.id));
  const indicatorIds = new Set(c.motivation.flatMap((d) => d.indicators.map((i) => i.id)));
  if (c.stages.length !== 7 || c.stages.some((s, i) => s.id !== i + 1)) errors.push('يجب أن تتكون الاستراتيجية من سبع خطوات مرتبة 1–7.');
  if (c.skills.length !== 18) errors.push(`عدد المهارات ${c.skills.length} والمعتمد 18.`);
  if (indicatorIds.size !== 26) errors.push(`عدد مؤشرات الدافعية ${indicatorIds.size} والمعتمد 26.`);
  if (c.lessons.length !== 9) errors.push(`عدد الحصص ${c.lessons.length} والمعتمد 9.`);
  const seen = new Set<string>();
  for (const l of c.lessons) {
    for (const s of [...l.skills, ...l.reinforcedSkills, ...(l.integratedSkills ?? [])]) if (!skillIds.has(s)) errors.push(`${l.id}: مهارة غير معتمدة ${s}`);
    if (l.status !== 'authored') { warnings.push(`${l.id}: مسودة (لم يُعدّ محتواها بعد).`); continue; }
    const stages = l.activities.map((a) => a.stage);
    for (let s = 1; s <= 7; s++) if (!stages.includes(s as any)) errors.push(`${l.id}: الخطوة ${s} غير موجودة.`);
    for (let i = 1; i < stages.length; i++) if (stages[i] < stages[i - 1]) errors.push(`${l.id}: ترتيب الخطوات مخالف عند النشاط ${l.activities[i].id}.`);
    if (!l.rubric) warnings.push(`${l.id}: لا توجد معايير تقويم للحصة.`);
    for (const a of l.activities) {
      if (seen.has(a.id)) errors.push(`معرف نشاط مكرر ${a.id}`);
      seen.add(a.id);
      for (const k of ['title', 'goal', 'expectedOutput'] as const) if (!a[k]) errors.push(`${a.id}: الحقل ${k} فارغ.`);
      if (!a.assistant?.name || !a.assistant.opening) errors.push(`${a.id}: تعليمات المساعد ناقصة.`);
      for (const s of a.skills) if (!l.skills.includes(s) && !l.reinforcedSkills.includes(s) && !(l.integratedSkills ?? []).includes(s)) errors.push(`${a.id}: المهارة ${s} ليست من مهارات الحصة.`);
      for (const m of a.motivation) if (!indicatorIds.has(m)) errors.push(`${a.id}: مؤشر دافعية غير معتمد ${m}.`);
      const fids = new Set(activityFields(a).map((f) => f.id));
      for (const r of a.requirements.fields) if (!fids.has(r)) errors.push(`${a.id}: متطلب لحقل غير موجود ${r}.`);
      if (a.stage === 6 && (!a.independent || a.assistant.mode !== 'disabled')) errors.push(`${a.id}: خطوة الإنتاج المستقل يجب أن تعطّل المساعد التوليدي.`);
      if (a.stage === 7 && !a.evaluation) errors.push(`${a.id}: خطوة التقويم يجب أن تحدد المنتج المستقل المصدر.`);
      for (const p of a.showProducts ?? []) if (!c.lessons.some((x) => x.id === p && x.number < l.number) && p !== l.id) errors.push(`${a.id}: منتج غير معروف أو لاحق ${p}.`);
      for (const f of activityFields(a)) for (const p of f.prefill ?? []) if (!c.lessons.some((x) => x.id === p.lesson && x.number < l.number)) errors.push(`${a.id}/${f.id}: استرجاع من حصة غير سابقة ${p.lesson}.`);
    }
  }
  return { errors, warnings };
}
