// يتحقق من التزام المحتوى بالاستراتيجية: سبع خطوات مرتبة، و18 مهارة، و26 مؤشرًا، وتسع حصص...
import { validateContent } from '../server/content.ts';
const { errors, warnings } = validateContent();
for (const w of warnings) console.log('تنبيه: ' + w);
for (const e of errors) console.log('خطأ: ' + e);
console.log(errors.length ? `\n${errors.length} خطأ.` : '\nالمحتوى سليم.');
process.exit(errors.length ? 1 : 0);
