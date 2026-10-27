// نقطة تشغيل خادم «تسمياتي».
import path from 'node:path';
import { createServer } from './http.ts';
import { ensureTeacher } from './auth.ts';
import { CONTENT_VERSION, validateContent } from './content.ts';
import { getAIConfig } from './ai.ts';
import { DB_PATH, getSetting, initDb, run, setSetting } from './db.ts';
import { flushReplica, replicaEnabled } from './replica.ts';
import './routes-student.ts';
import './routes-teacher.ts';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(process.cwd(), 'dist/public');

try {
  await initDb();
  if (replicaEnabled) console.log('قاعدة البيانات: محفوظة في Turso (سحابية دائمة) مع نسخة محلية للعمل.');
} catch (e: any) {
  console.error('تعذّر تهيئة القاعدة السحابية:', e?.message ?? e);
  process.exit(1);
}

const { errors, warnings } = validateContent();
if (errors.length) {
  console.error('أخطاء في المحتوى التعليمي:\n- ' + errors.join('\n- '));
  process.exit(1);
}
if (warnings.length) console.log('تنبيهات المحتوى: ' + warnings.length + ' (حصص مسودة لم يُعدّ محتواها بعد)');

// ترقية بنية المحتوى: تعديلات تعليمات المساعد والمعايير والسلالم الخاصة كانت مرتبطة بأنشطة البنية القديمة
if (getSetting<number>('contentVersion', 1) !== CONTENT_VERSION) {
  run("DELETE FROM overrides WHERE target LIKE 'activity:%' OR target LIKE 'rubric:%'");
  run("DELETE FROM settings WHERE key LIKE 'scale:%'");
  setSetting('contentVersion', CONTENT_VERSION);
  console.log(`حُدّثت بنية المحتوى إلى الإصدار ${CONTENT_VERSION}، ومُسحت تعديلات الأنشطة القديمة.`);
}

// نقل أنشطة الكتاب من الحصتين الأولى والتاسعة إلى أقسام خارج الحصص (مدخل الوحدة، وأنشطة الدروس، وختام الوحدة)
if (!getSetting<boolean>('bookSectionsMoved', false)) {
  const MOVE: [string, string, string][] = [
    ['1-K1', 'UI-K1', 'UI'], ['1-K2', 'UI-K2', 'UI'], ['1-K3', 'UI-K3', 'UI'], ['1-K4', 'UD1-K1', 'UD1'],
    ['9-K1', 'UD3-K1', 'UD3'], ['9-K2', 'UO-K1', 'UO'], ['9-K3', 'UO-K2', 'UO'], ['9-K4', 'UO-K3', 'UO'], ['9-K5', 'UO-K4', 'UO'], ['9-K6', 'UO-K5', 'UO'],
  ];
  for (const [from, to, lesson] of MOVE) {
    for (const t of ['responses', 'chat_messages', 'hint_log', 'feedback', 'teacher_notes', 'skill_log', 'shares', 'teacher_ratings']) run(`UPDATE ${t} SET activity_id = ? WHERE activity_id = ?`, to, from);
    run('UPDATE progress SET activity_id = ?, lesson_id = ? WHERE activity_id = ?', to, lesson, from);
    run('UPDATE overrides SET target = ? WHERE target = ?', `activity:${to}`, `activity:${from}`);
  }
  setSetting('bookSectionsMoved', true);
}
// إعادة أجزاء الكتاب إلى الحصص التسع مهماتٍ داخل مراحل الاستراتيجية
if (!getSetting<boolean>('bookInStages', false)) {
  const BACK: [string, string, string][] = [
    ['UI-K1', '1-K1', 'L01'], ['UI-K2', '1-K2', 'L01'], ['UI-K3', '1-K3', 'L01'], ['UD1-K1', '1-K4', 'L01'],
    ['UD3-K1', '9-K1', 'L09'], ['UO-K1', '9-K2', 'L09'], ['UO-K2', '9-K3', 'L09'], ['UO-K3', '9-K4', 'L09'], ['UO-K4', '9-K5', 'L09'], ['UO-K5', '9-K6', 'L09'],
  ];
  for (const [from, to, lesson] of BACK) {
    for (const t of ['responses', 'chat_messages', 'hint_log', 'feedback', 'teacher_notes', 'skill_log', 'shares', 'teacher_ratings']) run(`UPDATE ${t} SET activity_id = ? WHERE activity_id = ?`, to, from);
    run('UPDATE progress SET activity_id = ?, lesson_id = ? WHERE activity_id = ?', to, lesson, from);
    run('UPDATE overrides SET target = ? WHERE target = ?', `activity:${to}`, `activity:${from}`);
  }
  run("DELETE FROM lesson_state WHERE lesson_id IN ('UI', 'UD1', 'UD3', 'UO')");
  setSetting('bookInStages', true);
}

const pw = ensureTeacher();
if (pw) console.log(`\n=== أُنشئ حساب المعلمة. كلمة المرور: ${pw} — غيّريها من لوحة المعلمة ← الإعدادات ===\n`);

const ai = getAIConfig();
console.log(ai.enabled && ai.keyConfigured
  ? `المساعد الذكي: متصل بالمزود ${ai.provider} (${ai.model}).`
  : 'المساعد الذكي: وضع تجريبي غير متصل بالنموذج (لم يُضبط مفتاح API).');

const server = createServer(PUBLIC_DIR);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    server.close();
    if (replicaEnabled) await flushReplica(10000);
    process.exit(0);
  });
}
server.listen(PORT, () => {
  console.log(`تسمياتي يعمل على http://localhost:${PORT}  (قاعدة البيانات: ${DB_PATH})`);
});
