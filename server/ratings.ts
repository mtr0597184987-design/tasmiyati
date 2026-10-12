// سلالم التقدير: تقدير المعلمة لأداء كل طالبة في كل نشاط، وفق بنود مرتبطة بالمهارات المعتمدة.
// التقدير حكم المعلمة وحدها؛ لا يملؤه النموذج اللغوي ولا يُقترح منه.
import type { Activity, Lesson } from '../shared/types.ts';
import { all, getSetting, run, tx } from './db.ts';
import { skillText } from './content.ts';

export interface ScaleLevel { value: number; label: string }
export interface RatingCriterion { id: string; text: string }

export const DEFAULT_SCALE: ScaleLevel[] = [
  { value: 4, label: 'ممتاز' },
  { value: 3, label: 'جيد جدًا' },
  { value: 2, label: 'جيد' },
  { value: 1, label: 'يحتاج إلى دعم' },
];

export function ratingScale(): ScaleLevel[] {
  const s = getSetting<ScaleLevel[] | null>('ratingScale', null);
  return Array.isArray(s) && s.length >= 2 ? s : DEFAULT_SCALE;
}

/** بنود السلم الافتراضية: معايير الحصة في الإنتاج المستقل والتقويم، ونص المهارات المعتمدة في بقية الأنشطة */
export function defaultCriteria(lesson: Lesson, a: Activity): RatingCriterion[] {
  if ((a.independent || a.stage === 7) && lesson.rubric?.criteria?.length) {
    return lesson.rubric.criteria.map((c) => ({ id: `r-${c.id}`, text: c.text }));
  }
  const list: RatingCriterion[] = (a.skills ?? []).map((n) => ({ id: `s${n}`, text: skillText(n) })).filter((c) => c.text);
  list.push({ id: 'task', text: 'إنجاز مهمة النشاط واكتمالها ودقتها.' });
  return list;
}

export function activityCriteria(lesson: Lesson, a: Activity): { criteria: RatingCriterion[]; custom: boolean } {
  const o = getSetting<RatingCriterion[] | null>(`scale:${a.id}`, null);
  if (Array.isArray(o) && o.length) return { criteria: o, custom: true };
  return { criteria: defaultCriteria(lesson, a), custom: false };
}

export function getRatings(studentId: number, activityId: string): { values: Record<string, number>; note: string; updatedAt: string | null } {
  const rows = all('SELECT criterion_id, level, note, updated_at FROM teacher_ratings WHERE student_id = ? AND activity_id = ?', studentId, activityId);
  const values: Record<string, number> = {};
  let note = '';
  let updatedAt: string | null = null;
  for (const r of rows) {
    if (r.criterion_id === '__note') note = r.note ?? '';
    else if (r.level != null) values[r.criterion_id] = Number(r.level);
    if (!updatedAt || r.updated_at > updatedAt) updatedAt = r.updated_at;
  }
  return { values, note, updatedAt };
}

export function saveRatings(studentId: number, activityId: string, values: Record<string, number | null>, note: string | undefined, allowed: Set<string>, levels: Set<number>) {
  tx(() => {
    for (const [cid, lv] of Object.entries(values)) {
      if (!allowed.has(cid)) continue;
      if (lv == null) { run('DELETE FROM teacher_ratings WHERE student_id = ? AND activity_id = ? AND criterion_id = ?', studentId, activityId, cid); continue; }
      if (!levels.has(Number(lv))) continue;
      run(`INSERT INTO teacher_ratings(student_id, activity_id, criterion_id, level, updated_at) VALUES(?,?,?,?,datetime('now'))
           ON CONFLICT(student_id, activity_id, criterion_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`, studentId, activityId, cid, Number(lv));
    }
    if (note !== undefined) {
      const n = String(note).trim().slice(0, 2000);
      if (!n) run("DELETE FROM teacher_ratings WHERE student_id = ? AND activity_id = ? AND criterion_id = '__note'", studentId, activityId);
      else run(`INSERT INTO teacher_ratings(student_id, activity_id, criterion_id, note, updated_at) VALUES(?,?,'__note',?,datetime('now'))
                ON CONFLICT(student_id, activity_id, criterion_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`, studentId, activityId, n);
    }
  });
}
