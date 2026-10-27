import { productText } from '../shared/outline.ts';
// واجهات لوحة المعلمة. كل المسارات هنا تتطلب صلاحية المعلمة.
import { route, HttpError } from './http.ts';
import { all, get, getSetting, parse, run, setSetting, tx } from './db.ts';
import { hashPassword, newStudentCode, verifyPassword } from './auth.ts';
import { activityFields, allLessons, allUnits, findActivity, getLesson, EDITABLE_ASSISTANT_KEYS, loadContent, validateContent } from './content.ts';
import { activityStatuses, appSettings, getArtifact, getValues, DEFAULT_SETTINGS } from './logic.ts';
import { callModel, formatValue, getAIConfig, AIError } from './ai.ts';
import { portfolioData } from './portfolio.ts';
import { replicaStatus } from './replica.ts';
import { activityCriteria, getRatings, ratingScale, saveRatings } from './ratings.ts';
import { classAnalytics, studentAnalytics } from './analytics.ts';

function audit(actor: number, action: string, target = '') {
  run('INSERT INTO audit_log(actor_id, action, target) VALUES(?,?,?)', actor, action, target);
}

function studentOr404(id: string | number) {
  const s = get("SELECT * FROM users WHERE id = ? AND role = 'student'", Number(id));
  if (!s) throw new HttpError(404, 'الطالبة غير موجودة.');
  return s;
}

// ---------- الطالبات ----------
route('GET', '/api/teacher/overview', 'teacher', () => {
  const lessons = allUnits().filter((l) => l.activities.length);
  const students = all("SELECT id, code, label, real_name, group_name, free_navigation, created_at FROM users WHERE role = 'student' ORDER BY id");
  return {
    lessons: lessons.map((l) => ({ id: l.id, number: l.number, title: l.title, kind: l.kind ?? null, activities: l.activities.map((a) => ({ id: a.id, title: a.title, stage: a.stage, homework: !!a.homework, book: a.book ?? null })) })),
    students: students.map((s) => {
      const perLesson = Object.fromEntries(lessons.map((l) => [l.id, activityStatuses(s.id, l)]));
      const pendingShares = get("SELECT COUNT(*) AS n FROM shares WHERE student_id = ? AND status = 'pending'", s.id)?.n ?? 0;
      const last = get('SELECT MAX(updated_at) AS t FROM responses WHERE student_id = ?', s.id)?.t ?? null;
      return { ...s, name: s.real_name ?? null, freeNavigation: !!s.free_navigation, progress: perLesson, pendingShares, lastActivity: last };
    }),
    pending: {
      shares: get("SELECT COUNT(*) AS n FROM shares WHERE status = 'pending'")?.n ?? 0,
      comments: get("SELECT COUNT(*) AS n FROM share_comments WHERE status = 'pending'")?.n ?? 0,
      feedbackToReview: get("SELECT COUNT(*) AS n FROM feedback WHERE source = 'ai' AND reviewed = 0")?.n ?? 0,
    },
  };
});

route('POST', '/api/teacher/students', 'teacher', (c) => {
  // إما عدد من الرموز، وإما قائمة أسماء (اسم في كل سطر) يُنشأ لكل اسم رمز
  const names: string[] = Array.isArray(c.body?.names)
    ? c.body.names.map((x: unknown) => String(x ?? '').trim().slice(0, 80)).filter(Boolean).slice(0, 100)
    : [];
  const count = names.length || Math.max(1, Math.min(60, Number(c.body?.count) || 1));
  const prefix = String(c.body?.prefix ?? 'TS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TS';
  const group = String(c.body?.group ?? '').trim().slice(0, 40) || null;
  const created: { code: string; label: string; name: string | null }[] = [];
  tx(() => {
    let n = (get("SELECT COUNT(*) AS n FROM users WHERE role = 'student'")?.n ?? 0) as number;
    for (let i = 0; i < count; i++) {
      n++;
      let code = newStudentCode(prefix);
      while (get('SELECT 1 FROM users WHERE code = ?', code)) code = newStudentCode(prefix);
      let label = `طالبة ${String(n).padStart(2, '0')}`;
      while (get('SELECT 1 FROM users WHERE label = ?', label)) { n++; label = `طالبة ${String(n).padStart(2, '0')}`; }
      const name = names[i] ?? null;
      run("INSERT INTO users(role, code, label, real_name, group_name) VALUES('student', ?, ?, ?, ?)", code, label, name, group);
      created.push({ code, label, name });
    }
  });
  audit(c.user!.id, 'create_students', String(count));
  return { created };
});

route('PATCH', '/api/teacher/students/:id', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  const label = c.body?.label != null ? String(c.body.label).trim().slice(0, 40) || s.label : s.label;
  const group = c.body?.group !== undefined ? (String(c.body.group ?? '').trim().slice(0, 40) || null) : s.group_name;
  const free = c.body?.freeNavigation !== undefined ? (c.body.freeNavigation ? 1 : 0) : s.free_navigation;
  const name = c.body?.name !== undefined ? (String(c.body.name ?? '').trim().slice(0, 80) || null) : s.real_name;
  run('UPDATE users SET label = ?, real_name = ?, group_name = ?, free_navigation = ? WHERE id = ?', label, name, group, free, s.id);
  return { ok: true };
});

route('DELETE', '/api/teacher/students/:id', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  run('DELETE FROM users WHERE id = ?', s.id); // الحذف المتتالي يزيل كل بياناتها
  audit(c.user!.id, 'delete_student', s.code);
  return { ok: true };
});

route('GET', '/api/teacher/students/:id', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  const lessons = allUnits().filter((l) => l.activities.length).map((l) => {
    const st = activityStatuses(s.id, l);
    const prog = new Map(all('SELECT * FROM progress WHERE student_id = ? AND lesson_id = ?', s.id, l.id).map((p) => [p.activity_id, p]));
    return {
      id: l.id, number: l.number, title: l.title, kind: l.kind ?? null, rubric: l.rubric ?? null, productFields: l.productFields ?? [],
      initial: getArtifact(s.id, l.id, 'initial'),
      revised: getArtifact(s.id, l.id, 'revised'),
      activities: l.activities.map((a) => {
        const v = getValues(s.id, a.id);
        const self = v.__self ?? null;
        delete v.__self;
        return {
          id: a.id, title: a.title, stage: a.stage, homework: !!a.homework, book: a.book ?? null, status: st[a.id],
          openedAt: prog.get(a.id)?.opened_at ?? null, completedAt: prog.get(a.id)?.completed_at ?? null,
          unlockedByTeacher: !!prog.get(a.id)?.unlocked_by_teacher,
          answers: activityFields(a).filter((f) => v[f.id] != null).map((f) => ({ id: f.id, label: f.label, value: formatValue(f, v[f.id]) })),
          selfAssessment: self,
          hints: all('SELECT section_id, MAX(level) AS level FROM hint_log WHERE student_id = ? AND activity_id = ? GROUP BY section_id', s.id, a.id),
          feedback: all('SELECT id, source, data, visible, reviewed, created_at FROM feedback WHERE student_id = ? AND activity_id = ? ORDER BY id', s.id, a.id).map((f) => ({ ...f, data: parse(f.data, {}) })),
          notes: all('SELECT id, note, visible_to_student, created_at FROM teacher_notes WHERE student_id = ? AND activity_id = ? ORDER BY id', s.id, a.id),
          chatCount: get('SELECT COUNT(*) AS n FROM chat_messages WHERE student_id = ? AND activity_id = ?', s.id, a.id)?.n ?? 0,
          rating: { criteria: activityCriteria(l, a).criteria, ...getRatings(s.id, a.id) },
        };
      }),
    };
  });
  return { student: { id: s.id, code: s.code, label: s.label, name: s.real_name ?? null, group: s.group_name, freeNavigation: !!s.free_navigation }, scale: ratingScale(), lessons };
});

// سجل المساعد: يُفتح عند الحاجة فقط، ويُسجَّل الاطلاع عليه
route('GET', '/api/teacher/students/:id/chat/:activity', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  audit(c.user!.id, 'view_chat_log', `${s.code}:${c.params.activity}`);
  return { messages: all('SELECT role, content, mode, created_at FROM chat_messages WHERE student_id = ? AND activity_id = ? ORDER BY id', s.id, c.params.activity) };
});

route('POST', '/api/teacher/students/:id/unlock', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  const f = findActivity(String(c.body?.activityId ?? ''));
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  run(`INSERT INTO progress(student_id, lesson_id, activity_id, status, unlocked_by_teacher) VALUES(?,?,?,'in_progress',1)
       ON CONFLICT(student_id, activity_id) DO UPDATE SET unlocked_by_teacher = 1`, s.id, f.lesson.id, f.activity.id);
  audit(c.user!.id, 'unlock_activity', `${s.code}:${f.activity.id}`);
  return { ok: true };
});

// إعادة فتح المنتج المستقل (لظرف تقني مثلًا): تُحفظ النسخة السابقة في السجل ولا تُحذف
route('POST', '/api/teacher/students/:id/reopen-independent', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  const lesson = getLesson(String(c.body?.lessonId ?? ''));
  if (!lesson) throw new HttpError(404, 'الحصة غير موجودة.');
  const init = getArtifact(s.id, lesson.id, 'initial');
  if (!init) throw new HttpError(400, 'لا توجد نسخة أولية لإعادة فتحها.');
  const ind = lesson.activities.find((a) => a.independent)!;
  tx(() => {
    const history = getSetting<any[]>(`reopened:${s.id}:${lesson.id}`, []);
    history.push({ data: init.data, meta: init.meta, reopenedAt: new Date().toISOString() });
    setSetting(`reopened:${s.id}:${lesson.id}`, history);
    run("DELETE FROM artifacts WHERE student_id = ? AND lesson_id = ? AND version = 'initial'", s.id, lesson.id);
    run("UPDATE progress SET status = 'in_progress', completed_at = NULL WHERE student_id = ? AND activity_id = ?", s.id, ind.id);
  });
  audit(c.user!.id, 'reopen_independent', `${s.code}:${lesson.id}`);
  return { ok: true };
});

// اعتماد المعلمة لمنتج الحصة (مثل المخطط النهائي في الحصة السادسة)
route('POST', '/api/teacher/students/:id/approve', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  const lessonId = String(c.body?.lessonId ?? '');
  const art = getArtifact(s.id, lessonId, 'revised') ?? getArtifact(s.id, lessonId, 'initial');
  if (!art) throw new HttpError(400, 'لا يوجد منتج لهذه الحصة بعد.');
  const meta = { ...art.meta, approvedAt: c.body?.approve === false ? null : new Date().toISOString() };
  run('UPDATE artifacts SET meta = ? WHERE id = ?', JSON.stringify(meta), art.id);
  audit(c.user!.id, 'approve_product', `${s.code}:${lessonId}`);
  return { ok: true, approvedAt: meta.approvedAt };
});

route('POST', '/api/teacher/notes', 'teacher', (c) => {
  const s = studentOr404(c.body?.studentId);
  const note = String(c.body?.note ?? '').trim().slice(0, 2000);
  if (!note) throw new HttpError(400, 'اكتبي الملاحظة أولًا.');
  run('INSERT INTO teacher_notes(student_id, activity_id, note, visible_to_student) VALUES(?,?,?,?)', s.id, c.body?.activityId ?? null, note, c.body?.visibleToStudent ? 1 : 0);
  return { ok: true };
});
route('DELETE', '/api/teacher/notes/:id', 'teacher', (c) => { run('DELETE FROM teacher_notes WHERE id = ?', Number(c.params.id)); return { ok: true }; });

// ---------- التغذية الراجعة: المعلمة تراجع الملاحظات الذكية، وتضيف ملاحظاتها ----------
route('POST', '/api/teacher/feedback', 'teacher', (c) => {
  const s = studentOr404(c.body?.studentId);
  const f = findActivity(String(c.body?.activityId ?? ''));
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  const criteria = Array.isArray(c.body?.criteria) ? c.body.criteria.map((x: any) => ({ id: String(x.id), observation: String(x.observation ?? '').slice(0, 1000), question: String(x.question ?? '').slice(0, 500) })).filter((x: any) => x.observation) : [];
  const text = String(c.body?.text ?? '').slice(0, 3000);
  if (!criteria.length && !text.trim()) throw new HttpError(400, 'اكتبي ملاحظة واحدة على الأقل.');
  run("INSERT INTO feedback(student_id, activity_id, source, data, visible, reviewed) VALUES(?,?,'teacher',?,1,1)", s.id, f.activity.id, JSON.stringify({ criteria, text }));
  return { ok: true };
});
route('PATCH', '/api/teacher/feedback/:id', 'teacher', (c) => {
  const fb = get('SELECT * FROM feedback WHERE id = ?', Number(c.params.id));
  if (!fb) throw new HttpError(404, 'الملاحظة غير موجودة.');
  run('UPDATE feedback SET visible = ?, reviewed = 1 WHERE id = ?', c.body?.visible === undefined ? fb.visible : c.body.visible ? 1 : 0, fb.id);
  return { ok: true };
});

// ---------- المشاركات بين الطالبات ----------
route('GET', '/api/teacher/shares', 'teacher', () => ({
  shares: all(`SELECT s.id, s.activity_id, s.content, s.status, s.scope, s.anonymous, s.created_at, u.label, u.real_name AS name, u.group_name FROM shares s JOIN users u ON u.id = s.student_id ORDER BY s.status = 'pending' DESC, s.id DESC`)
    .map((s) => ({ ...s, content: parse(s.content, {}) })),
  comments: all(`SELECT c.id, c.text, c.status, c.created_at, u.label, u.real_name AS name, s.activity_id, s.id AS share_id FROM share_comments c JOIN users u ON u.id = c.student_id JOIN shares s ON s.id = c.share_id ORDER BY c.status = 'pending' DESC, c.id DESC`),
}));
route('PATCH', '/api/teacher/shares/:id', 'teacher', (c) => {
  const status = ['approved', 'rejected', 'pending'].includes(c.body?.status) ? c.body.status : null;
  const scope = ['class', 'group'].includes(c.body?.scope) ? c.body.scope : null;
  const s = get('SELECT * FROM shares WHERE id = ?', Number(c.params.id));
  if (!s) throw new HttpError(404, 'المشاركة غير موجودة.');
  run('UPDATE shares SET status = ?, scope = ? WHERE id = ?', status ?? s.status, scope ?? s.scope, s.id);
  return { ok: true };
});
// المعلمة تختار عملًا لتشاركه مثالًا (باسم مستعار)
route('POST', '/api/teacher/shares', 'teacher', (c) => {
  const s = studentOr404(c.body?.studentId);
  const f = findActivity(String(c.body?.activityId ?? ''));
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  const v = getValues(s.id, f.activity.id);
  const content: Record<string, string> = {};
  for (const fl of activityFields(f.activity)) if ((c.body?.fields ?? []).includes(fl.id) && v[fl.id] != null) content[fl.label] = formatValue(fl, v[fl.id]);
  if (!Object.keys(content).length) throw new HttpError(400, 'لا توجد إجابات محفوظة في الحقول المختارة.');
  run("INSERT INTO shares(student_id, activity_id, content, status, anonymous) VALUES(?,?,?,'approved',1)", s.id, f.activity.id, JSON.stringify(content));
  return { ok: true };
});
route('PATCH', '/api/teacher/comments/:id', 'teacher', (c) => {
  const status = ['approved', 'rejected'].includes(c.body?.status) ? c.body.status : 'pending';
  run('UPDATE share_comments SET status = ? WHERE id = ?', status, Number(c.params.id));
  return { ok: true };
});

// ---------- المحتوى: مراجعة الحصص وإتاحتها، وتعديل تعليمات المساعد ومعايير التقويم ----------
route('GET', '/api/teacher/content', 'teacher', () => {
  const content = loadContent();
  const states = new Map(all('SELECT * FROM lesson_state').map((r) => [r.lesson_id, r]));
  const overrides = new Set(all('SELECT target FROM overrides').map((r) => r.target));
  return {
    validation: validateContent(),
    motivation: content.motivation,
    lessons: allUnits().map((l) => ({
      ...l,
      enabled: states.get(l.id) ? !!states.get(l.id)?.enabled : l.kind === 'book',
      reviewedAt: states.get(l.id)?.reviewed_at ?? null,
      overridden: l.activities.filter((a) => overrides.has(`activity:${a.id}`)).map((a) => a.id),
      rubricOverridden: overrides.has(`rubric:${l.id}`),
    })),
  };
});

route('PATCH', '/api/teacher/lessons/:id', 'teacher', (c) => {
  const l = getLesson(c.params.id);
  if (!l) throw new HttpError(404, 'الحصة غير موجودة.');
  if (c.body?.enabled && l.status !== 'authored') throw new HttpError(400, 'لا يمكن إتاحة حصة لم يُعدّ محتواها بعد.');
  const cur = get('SELECT * FROM lesson_state WHERE lesson_id = ?', l.id);
  if (c.body?.enabled && !cur?.reviewed_at && !c.body?.reviewed) throw new HttpError(400, 'راجعي محتوى الحصة واعتمديه قبل إتاحتها للطالبات.');
  const enabled = c.body?.enabled !== undefined ? (c.body.enabled ? 1 : 0) : cur?.enabled ?? 0;
  const reviewed = c.body?.reviewed ? new Date().toISOString() : cur?.reviewed_at ?? null;
  run(`INSERT INTO lesson_state(lesson_id, enabled, reviewed_at) VALUES(?,?,?)
       ON CONFLICT(lesson_id) DO UPDATE SET enabled = excluded.enabled, reviewed_at = excluded.reviewed_at, updated_at = datetime('now')`, l.id, enabled, reviewed);
  audit(c.user!.id, 'lesson_state', `${l.id}:${enabled}`);
  return { ok: true };
});

route('PUT', '/api/teacher/activities/:id/assistant', 'teacher', (c) => {
  const f = findActivity(c.params.id);
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  const a: Record<string, unknown> = {};
  const b = c.body ?? {};
  for (const k of EDITABLE_ASSISTANT_KEYS) {
    if (b[k] === undefined) continue;
    if (k === 'questions') {
      if (!Array.isArray(b.questions)) continue;
      const old = f.activity.assistant.questions;
      a.questions = b.questions.map((q: any, i: number) => ({ ...(old.find((o) => o.id === q.id) ?? {}), id: String(q.id || `q${i + 1}`), text: String(q.text ?? '').slice(0, 600), hints: Array.isArray(q.hints) ? q.hints.map(String) : old.find((o) => o.id === q.id)?.hints ?? [] })).filter((q: any) => q.text.trim());
    } else if (k === 'constraints') {
      if (Array.isArray(b.constraints)) a.constraints = b.constraints.map((x: any) => String(x).slice(0, 600)).filter((x: string) => x.trim());
    } else a[k] = String(b[k]).slice(0, 3000);
  }
  run(`INSERT INTO overrides(target, data) VALUES(?, ?) ON CONFLICT(target) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`, `activity:${f.activity.id}`, JSON.stringify({ assistant: a }));
  audit(c.user!.id, 'edit_assistant', f.activity.id);
  return { ok: true };
});
route('DELETE', '/api/teacher/activities/:id/assistant', 'teacher', (c) => {
  run('DELETE FROM overrides WHERE target = ?', `activity:${c.params.id}`);
  return { ok: true };
});

route('PUT', '/api/teacher/lessons/:id/rubric', 'teacher', (c) => {
  const l = getLesson(c.params.id);
  if (!l?.rubric) throw new HttpError(404, 'لا توجد معايير لهذه الحصة.');
  const crit = Array.isArray(c.body?.criteria) ? c.body.criteria : [];
  const criteria = crit.map((x: any, i: number) => {
    const old = l.rubric!.criteria.find((o) => o.id === x.id);
    return { id: String(x.id || `c${i + 1}`), text: String(x.text ?? '').slice(0, 400), skills: old?.skills ?? l.skills, fields: old?.fields ?? [] };
  }).filter((x: any) => x.text.trim());
  if (!criteria.length) throw new HttpError(400, 'يجب أن يتضمن التقويم معيارًا واحدًا على الأقل.');
  run(`INSERT INTO overrides(target, data) VALUES(?, ?) ON CONFLICT(target) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`, `rubric:${l.id}`, JSON.stringify({ criteria }));
  audit(c.user!.id, 'edit_rubric', l.id);
  return { ok: true };
});
route('DELETE', '/api/teacher/lessons/:id/rubric', 'teacher', (c) => { run('DELETE FROM overrides WHERE target = ?', `rubric:${c.params.id}`); return { ok: true }; });

// ---------- الإعدادات ----------
// ---------- سلالم التقدير ----------
// صفحة التقدير الجماعي: كل طالبات النشاط في جدول واحد
route('GET', '/api/teacher/ratings/:activity', 'teacher', (c) => {
  const f = findActivity(c.params.activity);
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  const { criteria, custom } = activityCriteria(f.lesson, f.activity);
  const students = all("SELECT id, code, label, real_name FROM users WHERE role = 'student' ORDER BY id");
  const st = (sid: number) => activityStatuses(sid, f.lesson)[f.activity.id];
  return {
    activity: { id: f.activity.id, title: f.activity.title, stage: f.activity.stage, lessonId: f.lesson.id },
    scale: ratingScale(), criteria, custom,
    students: students.map((x) => ({ id: x.id, code: x.code, label: x.label, name: x.real_name ?? null, status: st(x.id), ...getRatings(x.id, f.activity.id) })),
  };
});

route('PUT', '/api/teacher/students/:id/ratings', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  const f = findActivity(String(c.body?.activityId ?? ''));
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  const allowed = new Set(activityCriteria(f.lesson, f.activity).criteria.map((x) => x.id));
  const levels = new Set(ratingScale().map((x) => x.value));
  const values = c.body?.values && typeof c.body.values === 'object' ? c.body.values : {};
  saveRatings(s.id, f.activity.id, values, c.body?.note, allowed, levels);
  return { ok: true, ...getRatings(s.id, f.activity.id) };
});

// تعديل بنود السلم لنشاط (يسري على كل الطالبات)
route('PUT', '/api/teacher/activities/:id/scale', 'teacher', (c) => {
  const f = findActivity(c.params.id);
  if (!f) throw new HttpError(404, 'النشاط غير موجود.');
  const items: unknown[] = Array.isArray(c.body?.criteria) ? c.body.criteria : [];
  const clean = items.map((x: any) => ({ id: String(x?.id ?? '').slice(0, 40), text: String(x?.text ?? '').trim().slice(0, 300) })).filter((x) => x.text).slice(0, 15);
  if (!clean.length) throw new HttpError(400, 'أضيفي بندًا واحدًا على الأقل.');
  const used = new Set<string>();
  for (const x of clean) { if (!x.id || used.has(x.id)) { let i = 1; while (used.has(`k${i}`)) i++; x.id = `k${i}`; } used.add(x.id); }
  setSetting(`scale:${f.activity.id}`, clean);
  audit(c.user!.id, 'edit_scale', f.activity.id);
  return { ok: true };
});
route('DELETE', '/api/teacher/activities/:id/scale', 'teacher', (c) => {
  run('DELETE FROM settings WHERE key = ?', `scale:${c.params.id}`);
  return { ok: true };
});

// ---------- التقارير ----------
route('GET', '/api/teacher/analytics', 'teacher', () => classAnalytics());
route('GET', '/api/teacher/analytics/student/:id', 'teacher', (c) => {
  const s = studentOr404(c.params.id);
  return { student: { id: s.id, code: s.code, label: s.label, name: s.real_name ?? null }, ...studentAnalytics(s.id) };
});

// ---------- التصفير ----------
// work: تمحو عمل الطالبات وتُبقي رموزهن وأسماءهن. all: تحذف الطالبات وكل بياناتهن. المحتوى والإعدادات لا تتأثر.
route('POST', '/api/teacher/reset', 'teacher', (c) => {
  const mode = c.body?.mode === 'all' ? 'all' : c.body?.mode === 'work' ? 'work' : null;
  if (!mode) throw new HttpError(400, 'اختاري نوع التصفير.');
  if (String(c.body?.confirm ?? '').trim() !== 'تصفير') throw new HttpError(400, 'اكتبي كلمة «تصفير» للتأكيد.');
  const t = get('SELECT pass_hash FROM users WHERE id = ?', c.user!.id);
  if (!verifyPassword(String(c.body?.password ?? ''), t?.pass_hash)) throw new HttpError(400, 'كلمة مرور المعلمة غير صحيحة.');
  tx(() => {
    if (mode === 'all') {
      run("DELETE FROM users WHERE role = 'student'"); // الحذف المتتالي يزيل كل السجلات المرتبطة
    } else {
      for (const tb of ['progress', 'responses', 'artifacts', 'chat_messages', 'hint_log', 'feedback', 'teacher_notes', 'skill_log', 'teacher_ratings', 'share_comments', 'shares']) run(`DELETE FROM ${tb}`);
    }
    run("DELETE FROM settings WHERE key LIKE 'reopened:%'");
  });
  audit(c.user!.id, 'reset_' + mode);
  return { ok: true };
});

route('GET', '/api/teacher/settings', 'teacher', () => ({ app: appSettings(), ai: getAIConfig(), storage: replicaStatus(), scale: ratingScale() }));

route('PUT', '/api/teacher/settings', 'teacher', (c) => {
  const b = c.body ?? {};
  if (b.app) {
    const cur = appSettings();
    const next: any = { ...cur };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof b.app[k] === 'boolean') next[k] = b.app[k];
    setSetting('app', next);
  }
  if (b.ai) {
    const cur = getSetting<any>('ai', {});
    const next = { ...cur };
    if (typeof b.ai.enabled === 'boolean') next.enabled = b.ai.enabled;
    if (['anthropic', 'openai', 'gemini'].includes(b.ai.provider) && b.ai.provider !== cur.provider) {
      next.provider = b.ai.provider;
      if (cur.provider) { delete next.model; delete next.apiKey; } // مفتاح مزود لا يصلح لغيره
    }
    if (typeof b.ai.model === 'string' && b.ai.model.trim()) next.model = b.ai.model.trim().slice(0, 100);
    if (next.provider === 'gemini' && next.model && !/^gemini|^gemma/i.test(next.model)) delete next.model;
    if ((next.provider ?? 'anthropic') === 'anthropic' && next.model && !/^claude/i.test(next.model)) delete next.model;
    if (typeof b.ai.baseUrl === 'string' && /^https?:\/\//.test(b.ai.baseUrl)) next.baseUrl = b.ai.baseUrl.trim();
    if (Number(b.ai.maxTokens) >= 100 && Number(b.ai.maxTokens) <= 4000) next.maxTokens = Number(b.ai.maxTokens);
    if (typeof b.ai.apiKey === 'string' && b.ai.apiKey.trim()) next.apiKey = b.ai.apiKey.trim(); // يُحفظ في الخادم فقط
    if (b.ai.clearKey) delete next.apiKey;
    setSetting('ai', next);
    audit(c.user!.id, 'ai_settings');
  }
  if (b.scale !== undefined) {
    if (b.scale === null) run("DELETE FROM settings WHERE key = 'ratingScale'");
    else {
      const labels: string[] = (Array.isArray(b.scale) ? b.scale : []).map((x: unknown) => String(x ?? '').trim().slice(0, 40)).filter(Boolean);
      if (labels.length < 2 || labels.length > 6) throw new HttpError(400, 'يجب أن يتكون السلم من مستويين إلى ستة مستويات.');
      setSetting('ratingScale', labels.map((label, i) => ({ value: labels.length - i, label })));
    }
  }
  return { app: appSettings(), ai: getAIConfig(), scale: ratingScale() };
});

route('POST', '/api/teacher/ai/test', 'teacher', async () => {
  try {
    const t0 = Date.now();
    const reply = await callModel('أجيبي بجملة عربية قصيرة واحدة.', [{ role: 'user', content: 'اختبار اتصال: قولي «الاتصال يعمل».' }], { maxTokens: 60 });
    return { ok: true, reply, ms: Date.now() - t0 };
  } catch (e) {
    if (e instanceof AIError) return { ok: false, kind: e.kind, error: e.message };
    throw e;
  }
});

route('POST', '/api/teacher/password', 'teacher', (c) => {
  const t = get('SELECT pass_hash FROM users WHERE id = ?', c.user!.id);
  if (!verifyPassword(String(c.body?.current ?? ''), t?.pass_hash)) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة.');
  const next = String(c.body?.next ?? '');
  if (next.length < 8) throw new HttpError(400, 'يجب ألا تقل كلمة المرور الجديدة عن ثمانية محارف.');
  run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(next), c.user!.id);
  return { ok: true };
});

// ---------- التصدير ----------
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

const withNames = (c: any) => c.url.searchParams.get('names') === '1';

route('GET', '/api/teacher/export.csv', 'teacher', (c) => {
  const lessons = allUnits().filter((l) => l.activities.length);
  const names = withNames(c);
  const students = all("SELECT id, code, label, real_name, group_name FROM users WHERE role = 'student' ORDER BY id")
    .map((s): Record<string, any> => ({ ...s, label: names && s.real_name ? `${s.label} — ${s.real_name}` : s.label }));
  const header = ['المعرف الدراسي', names ? 'الاسم' : 'الاسم المستعار', 'المجموعة', 'الحصة', 'النشاط', 'الخطوة', 'الحالة', 'تاريخ الفتح', 'تاريخ الإكمال', 'الحقل', 'الإجابة', 'تاريخ الحفظ'];
  const rows: string[] = [header.map(csvCell).join(',')];
  for (const s of students) for (const l of lessons) {
    const st = activityStatuses(s.id, l);
    for (const a of l.activities) {
      const p = get('SELECT opened_at, completed_at FROM progress WHERE student_id = ? AND activity_id = ?', s.id, a.id);
      const resp = all('SELECT field_id, value, updated_at FROM responses WHERE student_id = ? AND activity_id = ?', s.id, a.id);
      const fields = activityFields(a);
      const base = [s.code, s.label, s.group_name, l.kind === 'book' ? l.title : l.number, a.id, a.stage, st[a.id], p?.opened_at, p?.completed_at];
      if (!resp.length) rows.push([...base, '', '', ''].map(csvCell).join(','));
      for (const r of resp) {
        const f = fields.find((x) => x.id === r.field_id);
        const val = r.field_id === '__self' ? r.value : f ? formatValue(f, parse(r.value, null)) : r.value;
        rows.push([...base, r.field_id === '__self' ? 'التقويم الذاتي' : f?.label ?? r.field_id, val, r.updated_at].map(csvCell).join(','));
      }
    }
    for (const l2 of lessons) for (const ver of ['initial', 'revised'] as const) {
      const art = getArtifact(s.id, l2.id, ver);
      if (!art) continue;
      for (const pf of l2.productFields ?? []) rows.push([s.code, s.label, s.group_name, l2.number, ver === 'initial' ? 'المنتج الأولي' : 'المنتج المحسن', '', '', '', '', pf.label, productText(pf, art.data[pf.id]), ver === 'initial' ? art.meta.submittedAt : art.updated_at].map(csvCell).join(','));
    }
  }
  c.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tasmiyati-data.csv"' });
  c.res.end('﻿' + rows.join('\r\n'));
});

// تقديرات المعلمة وفق سلالم التقدير
route('GET', '/api/teacher/export-ratings.csv', 'teacher', (c) => {
  const names = withNames(c);
  const scale = ratingScale();
  const lv = (v: number) => scale.find((x) => x.value === v)?.label ?? '';
  const students = all("SELECT id, code, label, real_name FROM users WHERE role = 'student' ORDER BY id");
  const header = ['المعرف الدراسي', 'الاسم المستعار', ...(names ? ['الاسم'] : []), 'الحصة', 'النشاط', 'عنوان النشاط', 'البند', 'الدرجة', 'المستوى', 'ملاحظة المعلمة', 'تاريخ التقدير'];
  const rows: string[] = [header.map(csvCell).join(',')];
  for (const s of students) for (const l of allUnits().filter((x) => x.activities.length)) for (const a of l.activities) {
    const r = getRatings(s.id, a.id);
    if (!Object.keys(r.values).length && !r.note) continue;
    const base = [s.code, s.label, ...(names ? [s.real_name ?? ''] : []), l.kind === 'book' ? l.title : l.number, a.id, a.title];
    for (const cr of activityCriteria(l, a).criteria) {
      const v = r.values[cr.id];
      rows.push([...base, cr.text, v ?? '', v != null ? lv(v) : '', '', r.updatedAt].map(csvCell).join(','));
    }
    if (r.note) rows.push([...base, 'ملاحظة عامة', '', '', r.note, r.updatedAt].map(csvCell).join(','));
  }
  c.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tasmiyati-ratings.csv"' });
  c.res.end('\ufeff' + rows.join('\r\n'));
});

route('GET', '/api/teacher/export.json', 'teacher', (c) => {
  const names = withNames(c);
  const students = all("SELECT id, code, label, real_name, group_name, created_at FROM users WHERE role = 'student' ORDER BY id");
  const data = {
    exportedAt: new Date().toISOString(),
    note: 'بيانات أداء ومنتجات وتقديرات المعلمة. لا تُعد قياسًا للدافعية.',
    ratingScale: ratingScale(),
    students: students.map((s) => ({
      code: s.code, label: s.label, ...(names ? { name: s.real_name ?? null } : {}), group: s.group_name,
      responses: all('SELECT activity_id, field_id, value, updated_at FROM responses WHERE student_id = ?', s.id).map((r) => ({ ...r, value: parse(r.value, null) })),
      progress: all('SELECT lesson_id, activity_id, status, opened_at, completed_at, unlocked_by_teacher FROM progress WHERE student_id = ?', s.id),
      artifacts: all('SELECT lesson_id, version, data, meta, created_at, updated_at FROM artifacts WHERE student_id = ?', s.id).map((r) => ({ ...r, data: parse(r.data, {}), meta: parse(r.meta, {}) })),
      feedback: all('SELECT activity_id, source, data, visible, created_at FROM feedback WHERE student_id = ?', s.id).map((r) => ({ ...r, data: parse(r.data, {}) })),
      hints: all('SELECT activity_id, section_id, level, created_at FROM hint_log WHERE student_id = ?', s.id),
      skills: all('SELECT skill_id, activity_id, created_at FROM skill_log WHERE student_id = ?', s.id),
      teacherNotes: all('SELECT activity_id, note, created_at FROM teacher_notes WHERE student_id = ?', s.id),
      teacherRatings: all('SELECT activity_id, criterion_id, level, note, updated_at FROM teacher_ratings WHERE student_id = ?', s.id),
    })),
  };
  c.res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="tasmiyati-data.json"' });
  c.res.end(JSON.stringify(data, null, 2));
});

route('GET', '/api/teacher/students/:id/portfolio', 'teacher', (c) => portfolioData(studentOr404(c.params.id).id));
