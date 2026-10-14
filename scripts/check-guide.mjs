// يتحقق من مطابقة الحصص لدليل المعلم: كل نص في الدليل (العناوين، ونصوص الأنشطة، والجداول، والإجراءات، والأهداف، والمعايير)
// موجود حرفيًا في ملفات الحصص، وأن المهمات بترتيب الدليل وأزمنته. التشغيل: node scripts/check-guide.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const guide = JSON.parse(fs.readFileSync(path.join(root, 'content/source/guide.json'), 'utf8'));
let missing = 0, checked = 0;
const report = [];
for (const g of guide) {
  const L = JSON.parse(fs.readFileSync(path.join(root, `content/lessons/lesson-0${g.number}.json`), 'utf8'));
  const strings = new Set();
  const walk = (x) => { if (typeof x === 'string') strings.add(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  walk(L);
  const blob = [...strings].join('\n');
  const need = (s, where) => { checked++; if (!strings.has(s) && !blob.includes(s)) { missing++; report.push(`✗ الحصة ${g.number} — ${where}: «${s.slice(0, 70)}…»`); } };
  need(g.title, 'عنوان الحصة');
  need(g.overview, 'الفكرة العامة');
  g.objectives.forEach((o, i) => need(o, `الهدف ${i + 1}`));
  for (const [k, v] of Object.entries(g.header)) if (['مهارات الكتابة', 'المنتج الكتابي', 'التطبيق الكتابي'].includes(k)) need(v, k);
  const core = L.activities.filter((a) => !a.homework);
  g.tasks.forEach((t, i) => {
    const a = core[i];
    if (!a || a.id !== t.id || a.stage !== t.stage || a.minutes !== t.minutes || a.title !== t.title) { missing++; report.push(`✗ ${t.id}: الترتيب أو المرحلة أو الزمن أو العنوان لا يطابق الدليل`); }
    checked++;
    t.teacher.forEach((p, j) => { checked++; if (a?.teacherProcedures?.[j] !== p) { missing++; report.push(`✗ ${t.id} إجراء المعلمة ${j + 1}`); } });
    t.student.forEach((p, j) => { checked++; if (a?.studentProcedures?.[j] !== p) { missing++; report.push(`✗ ${t.id} إجراء الطالبة ${j + 1}`); } });
    t.acts.forEach((act, j) => {
      const sec = a?.worksheet.sections[j];
      checked++;
      if (!sec || sec.number !== act.n || sec.title !== act.title) { missing++; report.push(`✗ ${t.id} نشاط (${act.n}): العنوان`); }
      for (const p of act.parts) {
        if (p.p) { checked++; if (!sec?.content?.some((c) => c.type === 'p' && c.text === p.p)) { missing++; report.push(`✗ ${t.id} نشاط (${act.n}): نص غير منقول حرفيًا`); } }
        else for (const row of p.t) for (const cell of row) {
          if (!cell || /^(أكتب هنا|اختاري من القائمة|أختار من القائمة|☐|\.+)$/.test(cell)) continue;
          need(cell, `${t.id} نشاط (${act.n}) خلية جدول`);
        }
      }
    });
  });
  const hw = L.activities.filter((a) => a.homework);
  if (g.homework) {
    need(g.homework.title, 'عنوان النشاط البيتي');
    g.homework.followup.forEach((f, i) => { checked++; if (hw[0]?.teacherProcedures?.[i] !== f) { missing++; report.push(`✗ متابعة المعلمة ${i + 1} في الحصة ${g.number}`); } });
    g.homework.tasks.forEach((t) => { need(t.title, 'عنوان مهمة بيتية'); t.parts.forEach((p) => p.p && need(p.p, 'نص مهمة بيتية')); });
  }
}
console.log(report.join('\n'));
console.log(`\nفُحص ${checked} عنصرًا من الدليل؛ غير المطابق: ${missing}.`);
process.exit(missing ? 1 : 0);
