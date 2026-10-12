// نقطة تشغيل خادم «تسمياتي».
import path from 'node:path';
import { createServer } from './http.ts';
import { ensureTeacher } from './auth.ts';
import { validateContent } from './content.ts';
import { getAIConfig } from './ai.ts';
import { DB_PATH, initDb } from './db.ts';
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
