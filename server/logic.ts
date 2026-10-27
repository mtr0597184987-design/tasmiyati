// منطق التعلم: التقدم وضبط الانتقال، والإجابات، والمتطلبات، والإنتاج المستقل، والتقويم.
import type { Activity, ActivityStatus, AppSettings, Field, Lesson } from '../shared/types.ts';
import { all, get, getSetting, parse, run, tx } from './db.ts';
import { activityFields, allLessons, allUnits, getLesson, isSection } from './content.ts';
import { HttpError } from './http.ts';
import { outlineStats, parsePlanner, parseTable, plannerStats, wordCount, paragraphCount } from '../shared/outline.ts';

export const DEFAULT_SETTINGS: AppSettings = {
  freeNavigation: false,
  peerComments: true,
  showTeacherProcedures: false,
  aiFeedbackVisibleImmediately: true,
};
export function appSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...getSetting<Partial<AppSettings>>('app', {}) };
}

export function lessonEnabled(lessonId: string): boolean {
  const r = get('SELECT enabled FROM lesson_state WHERE lesson_id = ?', lessonId);
  if (!r && isSection(lessonId)) return true; // أقسام الكتاب متاحة ما لم توقفها المعلمة
  return !!r?.enabled;
}

// ---------- الإجابات ----------
export function getValues(studentId: number, activityId: string): Record<string, any> {
  const rows = all('SELECT field_id, value FROM responses WHERE student_id = ? AND activity_id = ?', studentId, activityId);
  return Object.fromEntries(rows.map((r) => [r.field_id, parse(r.value, null)]));
}

export function isFilled(f: Field | undefined, v: any): boolean {
  if (v == null) return false;
  if (!f) return String(v).trim().length > 0;
  if (f.mustChange && f.defaultValue != null && String(v).trim() === f.defaultValue.trim()) return false;
  switch (f.type) {
    case 'outline': { const s = outlineStats(String(v)); return s.ideas >= (f.min ?? 1) && s.minDetails >= (f.minDetails ?? 0); }
    case 'textarea': case 'text':
      if (!String(v).trim()) return false;
      if (f.minWords && wordCount(String(v)) < f.minWords) return false;
      if (f.minParagraphs && paragraphCount(String(v)) < f.minParagraphs) return false;
      return true;
    case 'list': return Array.isArray(v) && v.filter((x) => String(x ?? '').trim()).length >= (f.min ?? 1);
    case 'planner': { const p = plannerStats(v); return !!p.mode && p.topic && p.ideas >= (f.min ?? 1) && p.minDetails >= (f.minDetails ?? 0); }
    case 'multi': return Array.isArray(v) && v.length >= (f.min ?? 1);
    case 'classify': return (f.items ?? []).every((it) => v?.[it.id]);
    case 'table': { const t = parseTable(v); return (f.rows ?? []).filter((r) => !f.optionalRows?.includes(r.id)).every((r) => (f.columns ?? []).every((c) => f.given?.[r.id]?.[c.id] != null || String(t?.[r.id]?.[c.id] ?? '').trim())); }
    case 'ordering': return Array.isArray(v) && v.length === (f.items?.length ?? 0);
    default: return String(v).trim().length > 0;
  }
}

/** فحص موضوعي فقط للحقول ذات الإجابة الواحدة (الترتيب والاختيار)، أما الإجابات المفتوحة فتُقيَّم بالمعايير */
export function checkField(f: Field, v: any): { correct: boolean; detail?: boolean[]; message?: string } | null {
  if (f.answerKey == null || v == null) return null;
  if (f.type === 'ordering' && Array.isArray(v)) {
    const key = f.answerKey as string[];
    const detail = key.map((k, i) => v[i] === k);
    return { correct: detail.every(Boolean), detail };
  }
  if (f.type === 'choice' || f.type === 'select') {
    const correct = v === f.answerKey;
    const message = f.optionFeedback?.[v] ?? (correct ? f.feedback?.ok : f.feedback?.no);
    return message ? { correct, message } : { correct };
  }
  if (f.type === 'multi' && Array.isArray(v)) {
    const key = new Set(f.answerKey as string[]);
    return { correct: v.length === key.size && v.every((x) => key.has(x)) };
  }
  if (f.type === 'table' && v && typeof v === 'object') {
    // مفتاح لخلايا الاختيار فقط: { rowId: { colId: value } }
    const key = f.answerKey as Record<string, Record<string, string>>;
    const cells: [string, string][] = [];
    for (const r of Object.keys(key)) for (const c of Object.keys(key[r])) cells.push([r, c]);
    if (!cells.every(([r, c]) => v?.[r]?.[c])) return null;
    const detail = cells.map(([r, c]) => v[r][c] === key[r][c]);
    return { correct: detail.every(Boolean), detail };
  }
  if (f.type === 'classify' && v && typeof v === 'object') {
    const key = f.answerKey as Record<string, string>;
    const items = (f.items ?? []).map((it) => it.id);
    if (!items.every((id) => v[id])) return null; // لا فحص قبل اكتمال التصنيف
    const detail = items.map((id) => v[id] === key[id]);
    return { correct: detail.every(Boolean), detail };
  }
  return null;
}

function sanitizeValue(f: Field, v: any): any {
  const str = (x: any, max = 4000) => String(x ?? '').slice(0, max);
  switch (f.type) {
    case 'list': return Array.isArray(v) ? v.slice(0, 20).map((x) => str(x, 500)) : [];
    case 'classify': {
      const out: Record<string, string> = {};
      const cats = new Set((f.categories ?? []).map((c) => c.id));
      for (const it of f.items ?? []) if (cats.has(v?.[it.id])) out[it.id] = v[it.id];
      return out;
    }
    case 'table': {
      if (typeof v === 'string') v = parseTable(v);
      const out: Record<string, Record<string, string>> = {};
      for (const r of f.rows ?? []) { out[r.id] = {}; for (const c of f.columns ?? []) out[r.id][c.id] = str(v?.[r.id]?.[c.id], 600); }
      return out;
    }
    case 'ordering': {
      const ids = new Set((f.items ?? []).map((i) => i.id));
      const arr = Array.isArray(v) ? v.filter((x) => ids.has(x)) : [];
      return arr.length === ids.size && new Set(arr).size === ids.size ? arr : (f.items ?? []).map((i) => i.id);
    }
    case 'choice': case 'select': return (f.options ?? []).some((o) => (typeof o === 'string' ? o : o.id) === v) ? v : null;
    case 'multi': {
      const ids = new Set((f.options ?? []).map((o) => (typeof o === 'string' ? o : o.id)));
      const arr = Array.isArray(v) ? [...new Set(v.filter((x) => ids.has(x)))] : [];
      return f.max ? arr.slice(0, f.max) : arr;
    }
    case 'planner': return JSON.stringify(parsePlanner(v));
    case 'chips': return str(v, 200);
    case 'outline': return str(v, 8000);
    default: return str(v, f.maxLength ?? 4000);
  }
}

export function saveValues(studentId: number, a: Activity, values: Record<string, any>) {
  if (a.independent && getArtifact(studentId, lessonOf(a.id), 'initial')) throw new HttpError(409, 'سُلِّمت النسخة الأصلية واعتُمدت، فلا يمكن تعديلها. يمكنكِ تحسينها في مرحلة التقويم والتحسين الذكي.');
  const fields = new Map(activityFields(a).map((f) => [f.id, f]));
  const checks: Record<string, any> = {};
  tx(() => {
    for (const [id, raw] of Object.entries(values ?? {})) {
      const f = fields.get(id);
      if (!f) continue;
      const v = sanitizeValue(f, raw);
      run(`INSERT INTO responses(student_id, activity_id, field_id, value, updated_at) VALUES(?,?,?,?,datetime('now'))
           ON CONFLICT(student_id, activity_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        studentId, a.id, id, JSON.stringify(v));
      const ch = checkField(f, v);
      if (ch) checks[id] = ch;
    }
  });
  return checks;
}

export function revealedSet(studentId: number, lesson: Lesson): Set<string> {
  const out = new Set<string>();
  for (const a of lesson.activities) {
    for (const m of a.materials) {
      if (m.type === 'criteria' && m.revealAfter) {
        const f = activityFields(a).find((x) => x.id === m.revealAfter);
        const r = get('SELECT value FROM responses WHERE student_id = ? AND activity_id = ? AND field_id = ?', studentId, a.id, m.revealAfter);
        if (r && isFilled(f, parse(r.value, null))) out.add(`${a.id}:${m.revealAfter}`);
      }
    }
  }
  return out;
}

// ---------- المنتجات ----------
export function lessonOf(activityId: string): string {
  return allUnits().find((l) => l.activities.some((a) => a.id === activityId))?.id ?? '';
}
export function getArtifact(studentId: number, lessonId: string, version: 'initial' | 'revised') {
  const r = get('SELECT * FROM artifacts WHERE student_id = ? AND lesson_id = ? AND version = ?', studentId, lessonId, version);
  return r ? { id: r.id as number, created_at: r.created_at as string, updated_at: r.updated_at as string, data: parse<Record<string, string>>(r.data, {}), meta: parse<any>(r.meta, {}) } : null;
}

// ---------- التقدم وضبط الانتقال ----------
export function progressMap(studentId: number): Map<string, any> {
  return new Map(all('SELECT * FROM progress WHERE student_id = ?', studentId).map((r) => [r.activity_id, r]));
}

export function activityStatuses(studentId: number, lesson: Lesson): Record<string, ActivityStatus> {
  const p = progressMap(studentId);
  const user = get('SELECT free_navigation FROM users WHERE id = ?', studentId);
  const free = appSettings().freeNavigation || !!user?.free_navigation;
  const out: Record<string, ActivityStatus> = {};
  let prevDone = true;
  for (const a of lesson.activities) {
    const r = p.get(a.id);
    // أنشطة كتاب الطالبة متاحة طوال الحصة، ولا تدخل في سلسلة الخطوات
    if (a.book) { out[a.id] = r?.status === 'completed' ? 'completed' : r ? 'in_progress' : 'available'; continue; }
    if (r?.status === 'completed') out[a.id] = 'completed';
    else if (prevDone || free || r?.unlocked_by_teacher) out[a.id] = r ? 'in_progress' : 'available';
    else out[a.id] = 'locked';
    prevDone = out[a.id] === 'completed';
  }
  return out;
}

export function assertAccessible(studentId: number, lesson: Lesson, a: Activity) {
  if (lesson.status !== 'authored' || !lessonEnabled(lesson.id)) throw new HttpError(403, 'هذه الحصة غير متاحة الآن. ستتيحها المعلمة في موعدها.');
  if (activityStatuses(studentId, lesson)[a.id] === 'locked') throw new HttpError(403, 'أكملي النشاط السابق أولًا، أو اطلبي من معلمتكِ فتح هذا النشاط.');
}

export function markOpened(studentId: number, lesson: Lesson, a: Activity) {
  run(`INSERT INTO progress(student_id, lesson_id, activity_id, status) VALUES(?,?,?, 'in_progress') ON CONFLICT DO NOTHING`, studentId, lesson.id, a.id);
}

/** المساعد التوليدي يُعطَّل في الحصة كلها ما دامت الطالبة قد بدأت الإنتاج المستقل ولم تسلّمه */
export function independentInProgress(studentId: number, lesson: Lesson): Activity | null {
  for (const a of lesson.activities) {
    if (!a.independent) continue;
    const p = get('SELECT status FROM progress WHERE student_id = ? AND activity_id = ?', studentId, a.id);
    if (p && !getArtifact(studentId, lesson.id, 'initial')) return a;
  }
  return null;
}

export function missingRequirements(studentId: number, lesson: Lesson, a: Activity): string[] {
  const values = getValues(studentId, a.id);
  const fields = new Map(activityFields(a).map((f) => [f.id, f]));
  const missing: string[] = [];
  for (const id of a.requirements.fields) {
    const f = fields.get(id);
    if (a.independent) continue; // تُتحقق عند التسليم
    if (!isFilled(f, values[id])) missing.push(f?.label ?? id);
  }
  if (a.requirements.submitted && !getArtifact(studentId, lesson.id, 'initial')) missing.push('تسليم النسخة الأصلية من المنتج المستقل');
  if (a.requirements.selfAssessment && !selfAssessmentComplete(studentId, lesson, a)) missing.push('إكمال التقويم الذاتي لكل المعايير');
  if (a.requirements.revised && !getArtifact(studentId, lesson.id, 'revised')) missing.push('حفظ النسخة المحسنة');
  return missing;
}

export function selfAssessment(studentId: number, a: Activity): Record<string, { level: string; note?: string }> {
  return getValues(studentId, a.id).__self ?? {};
}
export function selfAssessmentComplete(studentId: number, lesson: Lesson, a: Activity): boolean {
  const s = selfAssessment(studentId, a);
  return !!lesson.rubric && lesson.rubric.criteria.every((c) => s[c.id]?.level);
}

export function completeActivity(studentId: number, lesson: Lesson, a: Activity) {
  const missing = missingRequirements(studentId, lesson, a);
  if (missing.length) throw new HttpError(400, 'لم تكتمل متطلبات النشاط بعد.', { missing });
  tx(() => {
    run(`INSERT INTO progress(student_id, lesson_id, activity_id, status, completed_at) VALUES(?,?,?,'completed',datetime('now'))
         ON CONFLICT(student_id, activity_id) DO UPDATE SET status='completed', completed_at=COALESCE(progress.completed_at, datetime('now'))`,
      studentId, lesson.id, a.id);
    for (const s of a.skills) run('INSERT OR IGNORE INTO skill_log(student_id, skill_id, activity_id) VALUES(?,?,?)', studentId, s, a.id);
  });
}

export function submitIndependent(studentId: number, lesson: Lesson, a: Activity, values: Record<string, any>, meta: any) {
  if (getArtifact(studentId, lesson.id, 'initial')) throw new HttpError(409, 'سُلِّمت النسخة الأصلية من قبل.');
  saveValues(studentId, a, values);
  const v = getValues(studentId, a.id);
  const fields = activityFields(a);
  const missing = a.requirements.fields.filter((id) => !isFilled(fields.find((f) => f.id === id), v[id])).map((id) => fields.find((f) => f.id === id)?.label ?? id);
  if (missing.length) throw new HttpError(400, 'أكملي جميع عناصر البطاقة قبل التسليم.', { missing });
  const data: Record<string, string> = {};
  for (const f of fields) data[f.id] = v[f.id] != null && typeof v[f.id] === 'object' ? JSON.stringify(v[f.id]) : String(v[f.id] ?? '');
  const opened = get('SELECT opened_at FROM progress WHERE student_id = ? AND activity_id = ?', studentId, a.id);
  const m = {
    submittedAt: new Date().toISOString(),
    openedAt: opened?.opened_at ? opened.opened_at.replace(' ', 'T') + 'Z' : null,
    pasteCount: Math.max(0, Math.min(999, Number(meta?.pasteCount) || 0)),
    aiBlocked: true,
  };
  run('INSERT INTO artifacts(student_id, lesson_id, version, data, meta) VALUES(?,?,?,?,?)', studentId, lesson.id, 'initial', JSON.stringify(data), JSON.stringify(m));
  completeActivity(studentId, lesson, a);
  return m;
}

export function saveRevised(studentId: number, lesson: Lesson, a: Activity, values: Record<string, any>) {
  if (!getArtifact(studentId, lesson.id, 'initial')) throw new HttpError(400, 'لا توجد نسخة أولية بعد.');
  if (!selfAssessmentComplete(studentId, lesson, a)) throw new HttpError(400, 'ابدئي بالتقويم الذاتي لكل المعايير قبل التعديل.');
  const data: Record<string, string> = {};
  for (const f of lesson.productFields ?? []) {
    const x = values?.[f.id];
    data[f.id] = (x != null && typeof x === 'object' ? JSON.stringify(sanitizeValue(f, x)) : f.type === 'planner' ? sanitizeValue(f, x) : String(x ?? '')).slice(0, f.maxLength ?? 15000);
  }
  run(`INSERT INTO artifacts(student_id, lesson_id, version, data) VALUES(?,?,'revised',?)
       ON CONFLICT(student_id, lesson_id, version) DO UPDATE SET data = excluded.data, meta = '{}', updated_at = datetime('now')`,
    studentId, lesson.id, JSON.stringify(data));
}

/** أحدث نسخة من منتج كل حصة (المحسنة إن وُجدت، وإلا الأولية) */
export function latestProducts(studentId: number) {
  return allLessons().filter((l) => l.productFields?.length).map((l) => {
    const rev = getArtifact(studentId, l.id, 'revised');
    const ini = getArtifact(studentId, l.id, 'initial');
    const a = rev ?? ini;
    return {
      lessonId: l.id, number: l.number, title: l.title,
      fields: (l.productFields ?? []).map((f) => ({ id: f.id, label: f.label, type: f.type, rows: f.rows, columns: f.columns, rowHeader: f.rowHeader })),
      data: a?.data ?? null, version: rev ? 'revised' : ini ? 'initial' : null,
      updatedAt: rev?.updated_at ?? ini?.meta?.submittedAt ?? null,
      approvedAt: (rev ?? ini)?.meta?.approvedAt ?? null,
    };
  });
}

export function getLessonOr404(id: string): Lesson {
  const l = getLesson(id);
  if (!l) throw new HttpError(404, 'الحصة غير موجودة.');
  return l;
}
