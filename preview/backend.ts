// الخادم داخل المتصفح لنسخة المعاينة: المسارات والمنطق نفسها، مع بيانات تجريبية أولية.
(globalThis as any).process.env.TEACHER_PASSWORD = 'preview';
import '../server/routes-student.ts';
import '../server/routes-teacher.ts';
import { ensureTeacher } from '../server/auth.ts';
import { get, run } from '../server/db.ts';
import { dispatch } from './http-browser.ts';
import { resetPreviewDb } from './sqlite-browser.ts';

export const PREVIEW_CODES = ['DEMO-1', 'DEMO-2', 'DEMO-3'];

ensureTeacher();
if (!get("SELECT 1 FROM users WHERE code = ?", 'DEMO-1')) {
  // DEMO-3 تتنقل بحرية بين الأنشطة لتسهيل استعراض الحصص
  PREVIEW_CODES.forEach((c, i) => run("INSERT INTO users(role, code, label, free_navigation) VALUES('student', ?, ?, ?)", c, `طالبة 0${i + 1}`, i === 2 ? 1 : 0));
}
for (let n = 1; n <= 9; n++) {
  run("INSERT INTO lesson_state(lesson_id, enabled, reviewed_at) VALUES(?, 1, ?) ON CONFLICT(lesson_id) DO NOTHING", `L0${n}`, new Date().toISOString());
}

export function resetPreview() {
  resetPreviewDb();
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && /^(ts-|tasmiyati-)/.test(k)) localStorage.removeItem(k); } } catch { /* */ }
  location.hash = '';
  location.reload();
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const r = await dispatch((init?.method ?? 'GET').toUpperCase(), url, init?.body ?? null);
  return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
};
(window as any).__resetPreview = resetPreview;
