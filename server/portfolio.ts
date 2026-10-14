import { productText } from '../shared/outline.ts';
// ملف الإنجاز الكتابي للطالبة. لا يُعرض فيه عدد مرات استخدام المساعد؛ فهو ليس مؤشرًا على جودة الكتابة أو الدافعية.
import { all, get, parse } from './db.ts';
import { activityFields, allLessons, loadContent } from './content.ts';
import { formatValue } from './ai.ts';
import { getArtifact, getValues, latestProducts } from './logic.ts';

export function portfolioData(studentId: number) {
  const user = get('SELECT label, real_name, group_name FROM users WHERE id = ?', studentId);
  const content = loadContent();
  const progress = all('SELECT activity_id, status, completed_at FROM progress WHERE student_id = ?', studentId);
  const pmap = new Map(progress.map((p) => [p.activity_id, p]));
  const skillRows = all('SELECT skill_id, COUNT(*) AS n, MAX(created_at) AS last FROM skill_log WHERE student_id = ? GROUP BY skill_id ORDER BY skill_id', studentId);

  const lessons = allLessons().filter((l) => l.activities.length).map((l) => {
    const activities = l.activities.map((a) => ({
      id: a.id, title: a.title, stage: a.stage,
      status: pmap.get(a.id)?.status ?? 'not_started',
      completedAt: pmap.get(a.id)?.completed_at ?? null,
    }));
    const goals: string[] = [];
    const reflections: { activity: string; question: string; text: string }[] = [];
    const planningCards: { activity: string; rows: { label: string; value: string }[] }[] = [];
    let selfAssessment: { criterion: string; level: string; note?: string }[] = [];
    let feedback: any[] = [];
    for (const a of l.activities) {
      const v = getValues(studentId, a.id);
      for (const f of activityFields(a)) {
        if (f.portfolio === 'goal' && v[f.id]) goals.push(String(v[f.id]));
        if (f.portfolio === 'reflection' && v[f.id]) reflections.push({ activity: a.title, question: f.label, text: String(v[f.id]) });
      }
      if (a.portfolio === 'planningCard' && Object.keys(v).length) {
        planningCards.push({ activity: a.title, rows: activityFields(a).filter((f) => v[f.id] != null).map((f) => ({ label: f.label, value: formatValue(f, v[f.id]) })) });
      }
      if (a.evaluation && l.rubric) {
        const levels = Object.fromEntries(l.rubric.levels.map((x) => [x.id, x.label]));
        const s = v.__self ?? {};
        selfAssessment = l.rubric.criteria.filter((c) => s[c.id]).map((c) => ({ criterion: c.text, level: levels[s[c.id].level], note: s[c.id].note }));
        feedback = all('SELECT source, data, created_at FROM feedback WHERE student_id = ? AND activity_id = ? AND visible = 1 ORDER BY id', studentId, a.id)
          .map((f) => ({ source: f.source, data: parse(f.data, {}), createdAt: f.created_at, criteria: l.rubric!.criteria }));
      }
    }
    const fields = l.productFields ?? [];
    const initial = getArtifact(studentId, l.id, 'initial');
    const revised = getArtifact(studentId, l.id, 'revised');
    return {
      id: l.id, number: l.number, title: l.title,
      completed: activities.every((a) => a.status === 'completed'),
      activities, goals, reflections, planningCards, selfAssessment, feedback,
      product: initial ? {
        fields,
        initial: initial.data, initialAt: initial.meta.submittedAt,
        revised: revised?.data ?? null, revisedAt: revised?.updated_at ?? null,
      } : null,
      teacherNotes: all('SELECT note, created_at FROM teacher_notes WHERE student_id = ? AND visible_to_student = 1 AND activity_id IN (' + l.activities.map(() => '?').join(',') + ')', studentId, ...l.activities.map((a) => a.id)),
    };
  });

  const journey = latestProducts(studentId);
  const last = journey.find((p) => p.lessonId === 'L09' && p.data);
  return {
    journey,
    finalText: last ? { title: last.data!.title, intro: last.data!.intro, body: last.data!.body, conclusion: last.data!.conclusion, version: last.version, updatedAt: last.updatedAt, approvedAt: last.approvedAt } : null,
    student: { label: user?.real_name || user?.label, group: user?.group_name },
    generatedAt: new Date().toISOString(),
    skills: skillRows.map((r) => ({ id: r.skill_id, text: content.skills.find((s) => s.id === r.skill_id)?.text, activities: r.n, last: r.last })),
    lessons,
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export function portfolioHtml(d: ReturnType<typeof portfolioData>): string {
  const sec = (title: string, body: string) => body ? `<section><h2>${esc(title)}</h2>${body}</section>` : '';
  const lessons = d.lessons.filter((l) => l.activities.some((a) => a.status !== 'not_started')).map((l) => `
    <article>
      <h2>الحصة ${l.number}: ${esc(l.title)} ${l.completed ? '<span class="tag">مكتملة</span>' : ''}</h2>
      <table><tr><th>النشاط</th><th>الحالة</th><th>تاريخ الإكمال</th></tr>
      ${l.activities.map((a) => `<tr><td>(${a.id}) ${esc(a.title)}</td><td>${a.status === 'completed' ? 'مكتمل' : a.status === 'in_progress' ? 'قيد الإنجاز' : '—'}</td><td>${esc(a.completedAt ?? '')}</td></tr>`).join('')}</table>
      ${l.goals.length ? `<h3>أهدافي الشخصية</h3><ul>${l.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${l.planningCards.map((p) => `<h3>بطاقة التخطيط</h3><table>${p.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join('')}</table>`).join('')}
      ${l.product ? `<h3>منتجي الكتابي: النسخة الأصلية والمحسنة</h3><table><tr><th></th><th>النسخة الأصلية</th><th>النسخة المحسنة</th></tr>
        ${l.product.fields.map((f) => `<tr><th>${esc(f.label)}</th><td style="white-space:pre-wrap">${esc(productText(f, l.product!.initial[f.id]))}</td><td style="white-space:pre-wrap">${esc(l.product!.revised ? productText(f, l.product!.revised[f.id]) : '—')}</td></tr>`).join('')}</table>` : ''}
      ${l.selfAssessment.length ? `<h3>تقويمي الذاتي</h3><table>${l.selfAssessment.map((s) => `<tr><th>${esc(s.criterion)}</th><td>${esc(s.level)}${s.note ? ' — ' + esc(s.note) : ''}</td></tr>`).join('')}</table>` : ''}
      ${l.feedback.map((f) => `<h3>${f.source === 'ai' ? 'ملاحظات المساعد التشخيصية' : 'ملاحظات المعلمة'}</h3>${f.data.raw ? `<p>${esc(f.data.raw)}</p>` : f.data.text ? `<p>${esc(f.data.text)}</p>` : `<ul>${(f.data.criteria ?? []).map((c: any) => `<li>${esc(c.observation)} ${c.question ? `<em>${esc(c.question)}</em>` : ''}</li>`).join('')}</ul>`}`).join('')}
      ${l.reflections.length ? `<h3>تأملاتي</h3>${l.reflections.map((r) => `<p><strong>${esc(r.question)}</strong><br>${esc(r.text)}</p>`).join('')}` : ''}
      ${l.teacherNotes.length ? `<h3>ملاحظات معلمتي</h3>${l.teacherNotes.map((n) => `<p>${esc(n.note)}</p>`).join('')}` : ''}
    </article>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملف إنجازي الكتابي</title>
<style>body{font-family:"IBM Plex Sans Arabic","Noto Naskh Arabic",Tahoma,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1f2d3a;line-height:1.8}
h1{color:#1f5f5b}h2{border-bottom:2px solid #e6dfd2;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #ddd5c6;padding:6px 8px;text-align:right;vertical-align:top}th{background:#f6f2ea;width:28%}
.tag{font-size:13px;background:#dcefe9;color:#1f5f5b;border-radius:99px;padding:2px 10px}article{margin-bottom:32px}@media print{article{break-inside:avoid-page}}</style></head>
<body><h1>ملف إنجازي الكتابي — تسمياتي</h1><p>${esc(d.student.label)}${d.student.group ? ' · ' + esc(d.student.group) : ''} · أُنشئ في ${esc(d.generatedAt.slice(0, 10))}</p>
${d.finalText ? `<section class="final"><h2>موضوعي الكامل</h2><h3 style="text-align:center">${esc(d.finalText.title)}</h3>${[d.finalText.intro, d.finalText.body, d.finalText.conclusion].join('\n').split(/\n+/).filter((p) => p.trim()).map((p) => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
${sec('رحلة موضوعي من التخطيط إلى النسخة النهائية', d.journey.filter((j) => j.data).map((j) => `<h3>الحصة ${j.number}: ${esc(j.title)} ${j.approvedAt ? '<span class="tag">اعتمدته المعلمة</span>' : ''}</h3><table>${j.fields.map((f) => `<tr><th>${esc(f.label)}</th><td style="white-space:pre-wrap">${esc(productText(f, j.data![f.id]))}</td></tr>`).join('')}</table>`).join(''))}
${sec('المهارات التي تدربتُ عليها', d.skills.length ? `<ul>${d.skills.map((s) => `<li>${esc(s.text)} <small>(${s.activities} نشاط)</small></li>`).join('')}</ul>` : '')}
${lessons || '<p>لم يبدأ العمل في الحصص بعد.</p>'}
<footer style="margin-top:40px;text-align:center;color:#76838e;font-size:13px">إعداد: تهاني محمد المحياوي</footer></body></html>`;
}
