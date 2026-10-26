// التقارير والتحليلات: تجميع التقدم وتقديرات المعلمة للصف ولكل طالبة.
// المصدر الوحيد للدرجات هو تقدير المعلمة في سلالم التقدير؛ لا يُحسب شيء من تقدير النموذج اللغوي.
import type { Lesson } from '../shared/types.ts';
import { all, get } from './db.ts';
import { allLessons, loadContent } from './content.ts';
import { activityStatuses } from './logic.ts';
import { activityCriteria, ratingScale } from './ratings.ts';

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** المهارات المعتمدة التي يقيسها بند معيّن في نشاط */
function criterionSkills(lesson: Lesson, criterionId: string): number[] {
  const m = /^s(\d+)$/.exec(criterionId);
  if (m) return [Number(m[1])];
  const r = /^r-(.+)$/.exec(criterionId);
  if (r) return lesson.rubric?.criteria.find((c) => c.id === r[1])?.skills ?? [];
  return [];
}

interface RatingRow { student_id: number; activity_id: string; criterion_id: string; level: number; updated_at: string }

function collect() {
  const lessons = allLessons().filter((l) => l.activities.length);
  const actLesson = new Map<string, Lesson>();
  const valid = new Map<string, Set<string>>(); // البنود السارية لكل نشاط
  for (const l of lessons) for (const a of l.activities) {
    actLesson.set(a.id, l);
    valid.set(a.id, new Set(activityCriteria(l, a).criteria.map((c) => c.id)));
  }
  const ratings = (all("SELECT student_id, activity_id, criterion_id, level, updated_at FROM teacher_ratings WHERE criterion_id != '__note' AND level IS NOT NULL") as RatingRow[])
    .filter((r) => valid.get(r.activity_id)?.has(r.criterion_id));
  return { lessons, actLesson, ratings };
}

function studentSummary(sid: number, lessons: Lesson[]) {
  let done = 0, total = 0;
  const perLesson: Record<string, { completed: number; started: number; total: number }> = {};
  for (const l of lessons) {
    const st = activityStatuses(sid, l);
    const vals = l.activities.filter((a) => !a.book).map((a) => st[a.id]); // اكتمال الحصة: الخطوات السبع والنشاط البيتي
    const c = vals.filter((x) => x === 'completed').length;
    perLesson[l.id] = { completed: c, started: vals.filter((x) => x === 'in_progress').length, total: vals.length };
    done += c; total += vals.length;
  }
  return { done, total, perLesson };
}

export function classAnalytics() {
  const { lessons, actLesson, ratings } = collect();
  const scale = ratingScale();
  const students = all("SELECT id, code, label, real_name FROM users WHERE role = 'student' ORDER BY id");
  const skills = loadContent().skills;

  // التقدم في كل حصة: عدد الطالبات اللاتي أكملنها، وبدأنها، ولم يبدأنها
  const lessonProgress = lessons.map((l) => ({ id: l.id, number: l.number, title: l.title, completed: 0, inProgress: 0, notStarted: 0 }));
  const summaries = new Map<number, ReturnType<typeof studentSummary>>();
  for (const s of students) {
    const sum = studentSummary(s.id, lessons);
    summaries.set(s.id, sum);
    lessons.forEach((l, i) => {
      const p = sum.perLesson[l.id];
      if (p.completed === p.total) lessonProgress[i].completed++;
      else if (p.completed > 0 || p.started > 0) lessonProgress[i].inProgress++;
      else lessonProgress[i].notStarted++;
    });
  }

  // متوسط التقدير في كل حصة، ولكل مهارة، وتوزيع المستويات
  const byLesson = new Map<string, number[]>();
  const bySkill = new Map<number, number[]>();
  const byStudent = new Map<number, number[]>();
  const dist = new Map<number, number>(scale.map((x) => [x.value, 0]));
  for (const r of ratings) {
    const l = actLesson.get(r.activity_id)!;
    (byLesson.get(l.id) ?? byLesson.set(l.id, []).get(l.id)!).push(r.level);
    (byStudent.get(r.student_id) ?? byStudent.set(r.student_id, []).get(r.student_id)!).push(r.level);
    for (const k of criterionSkills(l, r.criterion_id)) (bySkill.get(k) ?? bySkill.set(k, []).get(k)!).push(r.level);
    if (dist.has(r.level)) dist.set(r.level, dist.get(r.level)! + 1);
  }

  const now = Date.now();
  const lastActive = (sid: number): string | null => {
    const a = get('SELECT MAX(updated_at) AS t FROM responses WHERE student_id = ?', sid)?.t ?? null;
    const b = get('SELECT MAX(opened_at) AS t FROM progress WHERE student_id = ?', sid)?.t ?? null;
    return a && b ? (a > b ? a : b) : a ?? b;
  };

  const rows = students.map((s) => {
    const sum = summaries.get(s.id)!;
    const last = lastActive(s.id);
    const days = last ? Math.floor((now - new Date(String(last).replace(' ', 'T') + (String(last).includes('T') ? '' : 'Z')).getTime()) / 86400000) : null;
    return {
      id: s.id, code: s.code, label: s.label, name: s.real_name ?? null,
      completed: sum.done, total: sum.total,
      avgRating: avg(byStudent.get(s.id) ?? []), ratedCount: (byStudent.get(s.id) ?? []).length,
      lastActive: last, daysInactive: days,
    };
  });

  return {
    scale,
    totals: {
      students: students.length,
      completionPct: rows.length ? Math.round((rows.reduce((a, r) => a + r.completed / Math.max(1, r.total), 0) / rows.length) * 100) : 0,
      avgRating: avg(ratings.map((r) => r.level)),
      ratingsCount: ratings.length,
      ratedStudents: byStudent.size,
    },
    lessonProgress,
    lessonRatings: lessons.map((l) => ({ id: l.id, number: l.number, title: l.title, avg: avg(byLesson.get(l.id) ?? []), n: (byLesson.get(l.id) ?? []).length })),
    skillRatings: skills.map((k) => ({ id: k.id, text: k.text, avg: avg(bySkill.get(k.id) ?? []), n: (bySkill.get(k.id) ?? []).length })),
    distribution: scale.map((x) => ({ value: x.value, label: x.label, count: dist.get(x.value) ?? 0 })),
    students: rows,
  };
}

export function studentAnalytics(sid: number) {
  const { lessons, actLesson, ratings } = collect();
  const scale = ratingScale();
  const skills = loadContent().skills;
  const mine = ratings.filter((r) => r.student_id === sid);
  const sum = studentSummary(sid, lessons);

  const lessonAvg = (rs: RatingRow[], lid: string) => avg(rs.filter((r) => actLesson.get(r.activity_id)!.id === lid).map((r) => r.level));
  const skillAvg = (rs: RatingRow[], k: number) => avg(rs.filter((r) => criterionSkills(actLesson.get(r.activity_id)!, r.criterion_id).includes(k)).map((r) => r.level));

  // الخط الزمني: متى بدأت كل حصة وأكملتها وسلّمت وحسّنت
  const prog = all('SELECT lesson_id, activity_id, status, opened_at, completed_at FROM progress WHERE student_id = ?', sid);
  const arts = all('SELECT lesson_id, version, meta, created_at, updated_at FROM artifacts WHERE student_id = ?', sid);
  const timeline = lessons.map((l) => {
    const p = prog.filter((x) => x.lesson_id === l.id);
    const opened = p.map((x) => x.opened_at).filter(Boolean).sort()[0] ?? null;
    const lp = sum.perLesson[l.id];
    const completedAt = lp.completed === lp.total ? p.map((x) => x.completed_at).filter(Boolean).sort().slice(-1)[0] ?? null : null;
    const init = arts.find((a) => a.lesson_id === l.id && a.version === 'initial');
    const rev = arts.find((a) => a.lesson_id === l.id && a.version === 'revised');
    let approvedAt: string | null = null;
    try { approvedAt = JSON.parse((rev ?? init)?.meta ?? '{}').approvedAt ?? null; } catch { /* */ }
    let submittedAt: string | null = null;
    try { submittedAt = init ? JSON.parse(init.meta ?? '{}').submittedAt ?? init.created_at : null; } catch { submittedAt = init?.created_at ?? null; }
    return {
      id: l.id, number: l.number, title: l.title,
      completed: lp.completed, total: lp.total,
      openedAt: opened, completedAt, submittedAt, revisedAt: rev?.updated_at ?? null, approvedAt,
      avg: lessonAvg(mine, l.id), classAvg: lessonAvg(ratings, l.id),
    };
  });

  const skillRows = skills.map((k) => ({ id: k.id, text: k.text, avg: skillAvg(mine, k.id), classAvg: skillAvg(ratings, k.id) }));
  const rated = skillRows.filter((k) => k.avg != null).sort((a, b) => b.avg! - a.avg!);
  const top = scale[0].value;

  return {
    scale,
    summary: {
      completed: sum.done, total: sum.total,
      avgRating: avg(mine.map((r) => r.level)), classAvg: avg(ratings.map((r) => r.level)), ratedCount: mine.length,
      hints: get('SELECT COUNT(*) AS n FROM hint_log WHERE student_id = ?', sid)?.n ?? 0,
      messages: get("SELECT COUNT(*) AS n FROM chat_messages WHERE student_id = ? AND role = 'student'", sid)?.n ?? 0,
      revisions: arts.filter((a) => a.version === 'revised').length,
      submissions: arts.filter((a) => a.version === 'initial').length,
    },
    timeline,
    skills: skillRows,
    // نقاط القوة والدعم: من تقديرات المعلمة فقط، وبحد أدنى للاعتبار
    strengths: rated.filter((k) => k.avg! >= top * 0.75).slice(0, 3),
    needs: [...rated].reverse().filter((k) => k.avg! < top * 0.625).slice(0, 3),
  };
}
