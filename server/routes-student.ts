import { productText } from '../shared/outline.ts';
// واجهات برمجة الطالبة (وما تشترك فيه مع المعلمة).
import { route, HttpError } from './http.ts';
import { all, get, parse, run } from './db.ts';
import { clearCookie, clearFailures, makeToken, rateLimited, recordFailure, sessionCookie, verifyPassword } from './auth.ts';
import { activityFields, findActivity, lessonForStudent, loadContent, allLessons, allSections } from './content.ts';
import {
  activityStatuses, appSettings, assertAccessible, completeActivity, getArtifact, getLessonOr404, getValues, independentInProgress,
  latestProducts, lessonEnabled, markOpened, missingRequirements, revealedSet, saveRevised, saveValues, selfAssessment, selfAssessmentComplete, submitIndependent,
} from './logic.ts';
import { AIError, aiLive, buildSystemPrompt, callModel, demoReply, feedbackPrompt, formatValue, getAIConfig, parseFeedback, type ChatTurn } from './ai.ts';
import { portfolioData, portfolioHtml } from './portfolio.ts';

function ip(c: { req: any }) { return String(c.req.headers['x-forwarded-for'] ?? c.req.socket.remoteAddress ?? ''); }

// ---------- الدخول ----------
route('POST', '/api/auth/student', 'public', (c) => {
  const code = String(c.body?.code ?? '').trim().toUpperCase();
  if (rateLimited(ip(c))) throw new HttpError(429, 'محاولات كثيرة. انتظري عشر دقائق ثم حاولي مجددًا.');
  const u = get("SELECT id FROM users WHERE role = 'student' AND code = ?", code);
  if (!u) { recordFailure(ip(c)); throw new HttpError(401, 'الرمز الدراسي غير صحيح. تأكدي منه مع معلمتكِ.'); }
  clearFailures(ip(c));
  c.res.setHeader('set-cookie', sessionCookie(makeToken(u.id, 'student'), c.secure));
  return { ok: true };
});

route('POST', '/api/auth/teacher', 'public', (c) => {
  if (rateLimited(ip(c))) throw new HttpError(429, 'محاولات كثيرة. انتظري عشر دقائق ثم حاولي مجددًا.');
  const t = get("SELECT id, pass_hash FROM users WHERE role = 'teacher' LIMIT 1");
  if (!t || !verifyPassword(String(c.body?.password ?? ''), t.pass_hash)) { recordFailure(ip(c)); throw new HttpError(401, 'كلمة المرور غير صحيحة.'); }
  clearFailures(ip(c));
  c.res.setHeader('set-cookie', sessionCookie(makeToken(t.id, 'teacher'), c.secure));
  return { ok: true };
});

route('POST', '/api/auth/logout', 'public', (c) => { c.res.setHeader('set-cookie', clearCookie); return { ok: true }; });

route('GET', '/api/health', 'public', () => ({ ok: true }));
route('GET', '/api/me', 'any', (c) => ({ user: c.user, ai: aiState() }));

function aiState() {
  const cfg = getAIConfig();
  return { mode: cfg.enabled && cfg.keyConfigured ? 'live' : cfg.enabled ? 'demo' : 'off' };
}

// ---------- الفهرس والحصص ----------
route('GET', '/api/catalog', 'any', (c) => {
  const content = loadContent();
  const lessons = allLessons().map((l) => {
    const enabled = l.status === 'authored' && lessonEnabled(l.id);
    let progress = { done: 0, total: l.activities.length, current: null as null | { id: string; title: string; stage: number; homework?: boolean; book?: boolean } };
    if (c.user!.role === 'student' && l.activities.length) {
      const st = activityStatuses(c.user!.id, l);
      progress.done = l.activities.filter((a) => st[a.id] === 'completed').length;
      const cur = l.activities.find((a) => st[a.id] !== 'completed' && st[a.id] !== 'locked');
      if (cur) progress.current = { id: cur.id, title: cur.title, stage: cur.stage, homework: !!cur.homework, book: !!cur.book };
    }
    return {
      id: l.id, number: l.number, title: l.title, status: l.status, enabled, courseLesson: l.courseLesson,
      skills: l.skills, reinforcedSkills: l.reinforcedSkills, integratedSkills: l.integratedSkills ?? [], skillsNote: l.skillsNote,
      durationMinutes: l.durationMinutes, finalOutput: l.finalOutput, progress,
    };
  });
  // أقسام كتاب الطالبة خارج الحصص التسع
  const sections = allSections().map((l) => {
    const st = c.user!.role === 'student' ? activityStatuses(c.user!.id, l) : {};
    return {
      id: l.id, title: l.title, place: l.place, courseLesson: l.courseLesson.number, overview: l.overview ?? '', bookPages: l.bookPages ?? '',
      enabled: lessonEnabled(l.id),
      activities: l.activities.map((a) => ({ id: a.id, title: a.title, pages: a.book?.pages ?? '', test: !!a.book?.test, status: (st as any)[a.id] ?? 'available' })),
    };
  });
  return {
    sections,
    stages: content.stages.map(({ assistantFunction, ...s }) => (c.user!.role === 'teacher' ? { ...s, assistantFunction } : s)),
    skills: content.skills,
    domains: content.domains,
    lessons,
    ai: aiState(),
    settings: appSettings(),
  };
});

route('GET', '/api/lessons/:id', 'any', (c) => {
  const lesson = getLessonOr404(c.params.id);
  if (c.user!.role === 'teacher') return { lesson, statuses: {}, preview: true };
  if (lesson.status !== 'authored' || !lessonEnabled(lesson.id)) throw new HttpError(403, 'هذه الحصة غير متاحة الآن.');
  const l = lessonForStudent(lesson, revealedSet(c.user!.id, lesson), appSettings().showTeacherProcedures);
  // التلميحات تُطلب من الخادم وتُسجَّل، فلا تُرسَل مسبقًا
  for (const a of l.activities) for (const s of a.worksheet.sections) {
    (s as any).hintCount = s.hints?.length ?? 0;
    delete s.hints;
  }
  return { lesson: l, statuses: activityStatuses(c.user!.id, lesson) };
});

function ctxActivity(c: any) {
  const found = findActivity(c.params.id);
  if (!found) throw new HttpError(404, 'النشاط غير موجود.');
  if (c.user.role === 'student') assertAccessible(c.user.id, found.lesson, found.activity);
  return found;
}

route('GET', '/api/activities/:id', 'student', (c) => {
  const { lesson, activity: a } = ctxActivity(c);
  const sid = c.user!.id;
  const chat = all('SELECT role, content, mode, created_at FROM chat_messages WHERE student_id = ? AND activity_id = ? ORDER BY id', sid, a.id);
  const hints = all('SELECT section_id, MAX(level) AS level FROM hint_log WHERE student_id = ? AND activity_id = ? GROUP BY section_id', sid, a.id);
  const hintTexts: Record<string, any[]> = {};
  for (const h of hints) {
    const sec = a.worksheet.sections.find((s) => (s.id ?? s.title) === h.section_id);
    hintTexts[h.section_id] = (sec?.hints ?? []).filter((x) => x.level <= h.level);
  }
  const lockedBy = independentInProgress(sid, lesson);
  const evaluation = a.evaluation ? {
    initial: getArtifact(sid, lesson.id, 'initial'),
    revised: getArtifact(sid, lesson.id, 'revised'),
    self: selfAssessment(sid, a),
    selfComplete: selfAssessmentComplete(sid, lesson, a),
    feedback: all('SELECT id, source, data, created_at FROM feedback WHERE student_id = ? AND activity_id = ? AND visible = 1 ORDER BY id', sid, a.id)
      .map((f) => ({ ...f, data: parse(f.data, {}) })),
  } : null;
  const notes = all('SELECT note, created_at FROM teacher_notes WHERE student_id = ? AND activity_id = ? AND visible_to_student = 1 ORDER BY id', sid, a.id);
  const values = getValues(sid, a.id);
  delete values.__self;
  return {
    values,
    chat,
    hints: hintTexts,
    status: activityStatuses(sid, lesson)[a.id],
    initial: a.independent ? getArtifact(sid, lesson.id, 'initial') : null,
    chatBlocked: a.assistant.mode === 'disabled' ? 'independent' : lockedBy ? 'independent_lesson' : null,
    evaluation,
    teacherNotes: notes,
    myShares: all('SELECT id, status, created_at FROM shares WHERE student_id = ? AND activity_id = ?', sid, a.id),
    ai: aiState(),
  };
});

route('POST', '/api/activities/:id/open', 'student', (c) => {
  const { lesson, activity } = ctxActivity(c);
  markOpened(c.user!.id, lesson, activity);
  return { ok: true };
});

route('PUT', '/api/activities/:id/responses', 'student', (c) => {
  const { lesson, activity } = ctxActivity(c);
  markOpened(c.user!.id, lesson, activity);
  const checks = saveValues(c.user!.id, activity, c.body?.values ?? {});
  const revealed = revealedSet(c.user!.id, lesson);
  const reveal = activity.materials
    .filter((m) => m.type === 'criteria' && m.revealAfter && revealed.has(`${activity.id}:${m.revealAfter}`))
    .map((m) => m);
  return { saved: true, savedAt: new Date().toISOString(), checks, reveal };
});

route('POST', '/api/activities/:id/complete', 'student', (c) => {
  const { lesson, activity } = ctxActivity(c);
  completeActivity(c.user!.id, lesson, activity);
  return { ok: true, statuses: activityStatuses(c.user!.id, lesson) };
});

route('GET', '/api/activities/:id/requirements', 'student', (c) => {
  const { lesson, activity } = ctxActivity(c);
  return { missing: missingRequirements(c.user!.id, lesson, activity) };
});

// ---------- التلميحات المتدرجة ----------
route('POST', '/api/activities/:id/hint', 'student', (c) => {
  const { activity: a } = ctxActivity(c);
  const sectionId = String(c.body?.section ?? '');
  const sec = a.worksheet.sections.find((s) => (s.id ?? s.title) === sectionId);
  if (!sec?.hints?.length) throw new HttpError(404, 'لا توجد تلميحات لهذا الجزء.');
  if (sec.hintPolicy === 'after_attempt') {
    const v = getValues(c.user!.id, a.id);
    const tried = sec.fields.some((f) => String(v[f.id] ?? '').trim());
    if (!tried) throw new HttpError(400, 'حاولي أولًا واحفظي محاولتكِ، ثم تُتاح التلميحات.');
  }
  const cur = get('SELECT MAX(level) AS level FROM hint_log WHERE student_id = ? AND activity_id = ? AND section_id = ?', c.user!.id, a.id, sectionId);
  const next = Math.min((cur?.level ?? 0) + 1, sec.hints.length);
  if ((cur?.level ?? 0) < sec.hints.length) run('INSERT INTO hint_log(student_id, activity_id, section_id, level) VALUES(?,?,?,?)', c.user!.id, a.id, sectionId, next);
  return { hints: sec.hints.filter((h) => h.level <= next), done: next >= sec.hints.length };
});

// ---------- المساعد الذكي ----------
route('POST', '/api/activities/:id/chat', 'student', async (c) => {
  const { lesson, activity: a } = ctxActivity(c);
  const sid = c.user!.id;
  // منع برمجي: لا توليد في الإنتاج المستقل، ولا في أي نشاط من الحصة أثناء الإنتاج المستقل
  if (a.assistant.mode === 'disabled') throw new HttpError(423, a.book?.test ? 'المساعد متوقف في الاختبار. أجيبي بنفسكِ.' : 'المساعد التوليدي معطل في مرحلة الإنتاج المستقل. أنجزي المهمة بنفسكِ.');
  const lockedBy = independentInProgress(sid, lesson);
  if (lockedBy) throw new HttpError(423, 'المساعد التوليدي معطل حتى تسلّمي إنتاجكِ المستقل في نشاط «' + lockedBy.title + '».');
  const message = String(c.body?.message ?? '').trim().slice(0, 1500);
  if (!message) throw new HttpError(400, 'اكتبي رسالتكِ أولًا.');
  markOpened(sid, lesson, a);

  const history = all('SELECT role, content FROM chat_messages WHERE student_id = ? AND activity_id = ? ORDER BY id DESC LIMIT 16', sid, a.id).reverse();
  const studentTurns = all("SELECT COUNT(*) AS n FROM chat_messages WHERE student_id = ? AND activity_id = ? AND role = 'student'", sid, a.id)[0].n as number;

  if (!aiLive()) {
    const cfg = getAIConfig();
    if (!cfg.enabled) throw new HttpError(503, 'المساعد الذكي معطل الآن من إعدادات المعلمة. تابعي العمل في ورقة النشاط.');
    const reply = demoReply(a, studentTurns);
    run("INSERT INTO chat_messages(student_id, activity_id, role, content, mode) VALUES(?,?,'student',?,'demo')", sid, a.id, message);
    run("INSERT INTO chat_messages(student_id, activity_id, role, content, mode) VALUES(?,?,'assistant',?,'demo')", sid, a.id, reply);
    return { reply, mode: 'demo' };
  }

  const values = getValues(sid, a.id);
  delete values.__self;
  // زر مسمى في نشاط (مثل «فحص اختياراتي»): تعليمته تُضاف إلى سياق المساعد ولا تظهر للطالبة
  const sec = c.body?.assist ? a.worksheet.sections.find((x) => (x.id ?? x.title) === String(c.body.assist) && x.assist) : null;
  const assistCtx = sec ? `\n## طلب الطالبة الآن\nضغطت الطالبة زر «${sec.assist!.label}» في نشاط «${sec.title}». ${sec.assist!.message}\n` : '';
  const system = buildSystemPrompt(lesson, a, values, productsContext(sid, a.showProducts) + assistCtx);
  const turns: ChatTurn[] = [{ role: 'assistant', content: a.assistant.opening }];
  for (const h of history) turns.push({ role: h.role === 'student' ? 'user' : 'assistant', content: h.content });
  turns.push({ role: 'user', content: message });
  try {
    const reply = await callModel(system, turns);
    run("INSERT INTO chat_messages(student_id, activity_id, role, content, mode) VALUES(?,?,'student',?,'ai')", sid, a.id, message);
    run("INSERT INTO chat_messages(student_id, activity_id, role, content, mode) VALUES(?,?,'assistant',?,'ai')", sid, a.id, reply);
    return { reply, mode: 'ai' };
  } catch (e) {
    if (e instanceof AIError) throw new HttpError(502, e.message + ' إجاباتكِ في ورقة العمل محفوظة، ويمكنكِ المتابعة ثم المحاولة لاحقًا.', { kind: e.kind });
    throw e;
  }
});

// ---------- منتجات الحصص السابقة ----------
route('GET', '/api/products', 'student', (c) => ({ products: latestProducts(c.user!.id) }));

function productsContext(sid: number, ids?: string[]): string {
  if (!ids?.length) return '';
  const all = latestProducts(sid).filter((p) => ids.includes(p.lessonId));
  const parts = all.map((p) => p.data
    ? `منتج الحصة ${p.number} (${p.title}):\n` + p.fields.map((f) => `- ${f.label}: ${productText(f, p.data![f.id]).slice(0, 1500)}`).join('\n')
    : `منتج الحصة ${p.number}: لم تسلّمه الطالبة بعد.`);
  return `## منتجات الطالبة في الحصص السابقة (للاسترشاد فقط؛ لا تعيدي كتابتها)\n${parts.join('\n\n')}\n`;
}

// ---------- الإنتاج المستقل ----------
route('POST', '/api/activities/:id/submit', 'student', (c) => {
  const { lesson, activity: a } = ctxActivity(c);
  if (!a.independent) throw new HttpError(400, 'هذا النشاط ليس إنتاجًا مستقلًا.');
  markOpened(c.user!.id, lesson, a);
  const meta = submitIndependent(c.user!.id, lesson, a, c.body?.values ?? {}, c.body?.meta);
  return { ok: true, meta, statuses: activityStatuses(c.user!.id, lesson) };
});

// ---------- التقويم والتحسين ----------
function evalCtx(c: any) {
  const f = ctxActivity(c);
  if (!f.activity.evaluation || !f.lesson.rubric) throw new HttpError(400, 'هذا النشاط ليس نشاط تقويم.');
  if (!getArtifact(c.user.id, f.lesson.id, 'initial')) throw new HttpError(400, 'سلّمي إنتاجكِ المستقل أولًا.');
  return f;
}

route('PUT', '/api/activities/:id/self-assessment', 'student', (c) => {
  const { lesson, activity: a } = evalCtx(c);
  const levels = new Set(lesson.rubric!.levels.map((l) => l.id));
  const out: Record<string, { level: string; note: string }> = {};
  for (const cr of lesson.rubric!.criteria) {
    const r = c.body?.ratings?.[cr.id];
    if (r && levels.has(r.level)) out[cr.id] = { level: r.level, note: String(r.note ?? '').slice(0, 600) };
  }
  markOpened(c.user!.id, lesson, a);
  run(`INSERT INTO responses(student_id, activity_id, field_id, value) VALUES(?,?,'__self',?)
       ON CONFLICT(student_id, activity_id, field_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, c.user!.id, a.id, JSON.stringify(out));
  return { ok: true, complete: selfAssessmentComplete(c.user!.id, lesson, a) };
});

route('POST', '/api/activities/:id/feedback', 'student', async (c) => {
  const { lesson, activity: a } = evalCtx(c);
  const sid = c.user!.id;
  if (!selfAssessmentComplete(sid, lesson, a)) throw new HttpError(400, 'أكملي تقويمكِ الذاتي أولًا؛ فالملاحظات تأتي بعد أن تقوّمي إنتاجكِ بنفسكِ.');
  const existing = get("SELECT COUNT(*) AS n FROM feedback WHERE student_id = ? AND activity_id = ? AND source = 'ai'", sid, a.id);
  if ((existing?.n ?? 0) >= 3) throw new HttpError(429, 'وصلتِ إلى الحد الأقصى لطلب الملاحظات في هذا النشاط. راجعي الملاحظات السابقة أو اسألي معلمتكِ.');
  if (!aiLive()) throw new HttpError(503, 'الملاحظات التشخيصية الذكية تتطلب ربط النموذج، وهو غير مفعّل الآن (وضع تجريبي). ستضيف المعلمة ملاحظاتها، ويمكنكِ متابعة التحسين وفق المعايير.', { kind: 'demo' });
  const initial = getArtifact(sid, lesson.id, 'initial')!;
  const { system, user } = feedbackPrompt(lesson, a, initial.data, selfAssessment(sid, a));
  try {
    const text = await callModel(system, [{ role: 'user', content: user }], { maxTokens: 1600 });
    const data = parseFeedback(text);
    const visible = appSettings().aiFeedbackVisibleImmediately ? 1 : 0;
    const r = run("INSERT INTO feedback(student_id, activity_id, source, data, visible) VALUES(?,?,'ai',?,?)", sid, a.id, JSON.stringify(data), visible);
    return { id: Number(r.lastInsertRowid), data: visible ? data : null, pendingReview: !visible };
  } catch (e) {
    if (e instanceof AIError) throw new HttpError(502, e.message + ' يمكنكِ متابعة التحسين وفق المعايير، وستراجع المعلمة عملكِ.', { kind: e.kind });
    throw e;
  }
});

route('PUT', '/api/activities/:id/revised', 'student', (c) => {
  const { lesson, activity: a } = evalCtx(c);
  saveRevised(c.user!.id, lesson, a, c.body?.values ?? {});
  return { ok: true, revised: getArtifact(c.user!.id, lesson.id, 'revised') };
});

// ---------- التفاعل بين الطالبات (تديره المعلمة) ----------
route('POST', '/api/activities/:id/share', 'student', (c) => {
  const { lesson, activity: a } = ctxActivity(c);
  if (!a.peer?.enabled) throw new HttpError(400, 'المشاركة غير متاحة في هذا النشاط.');
  const sid = c.user!.id;
  let content: Record<string, string> = {};
  if (a.peer.fields.includes('revised')) {
    const r = getArtifact(sid, lesson.id, 'revised');
    if (!r) throw new HttpError(400, 'احفظي النسخة المحسنة أولًا.');
    for (const f of lesson.productFields ?? []) content[f.label] = productText(f, r.data[f.id]);
  } else {
    const v = getValues(sid, a.id);
    const fields = activityFields(a);
    for (const id of a.peer.fields) {
      const f = fields.find((x) => x.id === id);
      if (v[id] != null && v[id] !== '') content[f?.label ?? id] = f ? formatValue(f, v[id]) : String(v[id]);
    }
  }
  if (!Object.keys(content).length) throw new HttpError(400, 'احفظي إجابتكِ أولًا ثم شاركيها.');
  run("DELETE FROM shares WHERE student_id = ? AND activity_id = ? AND status = 'pending'", sid, a.id);
  run('INSERT INTO shares(student_id, activity_id, content, anonymous) VALUES(?,?,?,?)', sid, a.id, JSON.stringify(content), c.body?.anonymous === false ? 0 : 1);
  return { ok: true, message: 'أُرسلت مشاركتكِ إلى المعلمة، وستظهر لزميلاتكِ بعد موافقتها.' };
});

route('GET', '/api/activities/:id/gallery', 'student', (c) => {
  const { activity: a } = ctxActivity(c);
  const me = c.user!;
  const rows = all(`SELECT s.id, s.student_id, s.content, s.anonymous, s.scope, u.label, u.group_name FROM shares s JOIN users u ON u.id = s.student_id
                    WHERE s.activity_id = ? AND s.status = 'approved' ORDER BY s.id`, a.id)
    .filter((s) => s.scope === 'class' || s.group_name === me.group);
  return {
    commentsEnabled: appSettings().peerComments,
    items: rows.map((s, i) => ({
      id: s.id,
      mine: s.student_id === me.id,
      author: s.student_id === me.id ? 'أنتِ' : s.anonymous ? `زميلة (${i + 1})` : s.label,
      content: parse(s.content, {}),
      comments: all(`SELECT c.id, c.text, c.student_id, c.status FROM share_comments c WHERE c.share_id = ? AND (c.status = 'approved' OR c.student_id = ?) ORDER BY c.id`, s.id, me.id)
        .map((x) => ({ id: x.id, text: x.text, mine: x.student_id === me.id, pending: x.status !== 'approved' })),
    })),
  };
});

route('POST', '/api/shares/:id/comments', 'student', (c) => {
  if (!appSettings().peerComments) throw new HttpError(403, 'التعليقات متوقفة الآن.');
  const s = get("SELECT s.*, u.group_name FROM shares s JOIN users u ON u.id = s.student_id WHERE s.id = ? AND s.status = 'approved'", Number(c.params.id));
  if (!s) throw new HttpError(404, 'المشاركة غير موجودة.');
  if (s.scope === 'group' && s.group_name !== c.user!.group) throw new HttpError(403, 'لا يمكنكِ التعليق على هذه المشاركة.');
  const text = String(c.body?.text ?? '').trim().slice(0, 400);
  if (text.length < 3) throw new HttpError(400, 'اكتبي تعليقًا داعمًا أوضح.');
  run('INSERT INTO share_comments(share_id, student_id, text) VALUES(?,?,?)', s.id, c.user!.id, text);
  return { ok: true, message: 'أُرسل تعليقكِ، وسيظهر بعد مراجعة المعلمة.' };
});

// ---------- ملف الإنجاز ----------
route('GET', '/api/portfolio', 'student', (c) => portfolioData(c.user!.id));
route('GET', '/api/portfolio/export', 'student', (c) => {
  const html = portfolioHtml(portfolioData(c.user!.id));
  c.res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-disposition': `attachment; filename="tasmiyati-portfolio.html"`,
  });
  c.res.end(html);
});
