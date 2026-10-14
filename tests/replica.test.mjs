// اختبار النسخ إلى القاعدة السحابية: البيانات تبقى بعد مسح القرص المحلي وإعادة التشغيل (كما يحدث في الاستضافة المجانية).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockTurso } from './mock-turso.mjs';

const turso = await startMockTurso('tok');
const dirs = [];
let proc;
const PORT = 3700 + Math.floor(Math.random() * 200);

async function startServer(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsm-rep-'));
  dirs.push(dir);
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', process.env.SERVER_JS || 'dist/server.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, TEACHER_PASSWORD: 'pw-12345678', TURSO_DATABASE_URL: turso.url, TURSO_AUTH_TOKEN: 'tok', ...extraEnv }, stdio: 'pipe',
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no start: ' + log)), 10000);
    proc.stdout.on('data', (d) => { log += d; if (String(d).includes('يعمل على')) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', (d) => (log += d));
  });
  return log;
}
async function stopServer() {
  const done = new Promise((r) => proc.on('exit', r));
  proc.kill('SIGTERM');
  await done;
}
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}
after(() => { turso.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('البيانات تبقى في القاعدة السحابية بعد مسح القرص المحلي وإعادة التشغيل', async () => {
  await startServer();
  const t = client();
  assert.equal((await t('POST', '/api/auth/teacher', { password: 'pw-12345678' })).status, 200);
  const codes = (await t('POST', '/api/teacher/students', { count: 2 })).data.created;
  await t('PATCH', '/api/teacher/lessons/L01', { enabled: true, reviewed: true });
  const s = client();
  assert.equal((await s('POST', '/api/auth/student', { code: codes[0].code })).status, 200);
  await s('PUT', '/api/activities/1-1/responses', { values: { topic: 'ب', goal: 'ب', relation: 'نص محفوظ سحابيًا' } });
  assert.equal((await s('POST', '/api/activities/1-1/complete')).status, 200);
  await new Promise((r) => setTimeout(r, 400));
  const st = (await t('GET', '/api/teacher/settings')).data.storage;
  assert.equal(st.mode, 'turso');
  assert.equal(st.pending, 0);
  await stopServer();

  // قرص محلي جديد فارغ (كما بعد توقف الخدمة المجانية)
  const log = await startServer();
  assert.ok(log.includes('استُعيد'));
  const t2 = client();
  assert.equal((await t2('POST', '/api/auth/teacher', { password: 'pw-12345678' })).status, 200);
  const ov = (await t2('GET', '/api/teacher/overview')).data;
  assert.equal(ov.students.length, 2);
  assert.equal(ov.students[0].progress.L01['1-1'], 'completed');
  const s2 = client();
  assert.equal((await s2('POST', '/api/auth/student', { code: codes[0].code })).status, 200);
  const a = (await s2('GET', '/api/activities/1-1')).data;
  assert.equal(a.values.relation, 'نص محفوظ سحابيًا');
  // كتابة جديدة بعد الاستعادة تحمل معرفات متسقة
  await t2('POST', '/api/teacher/students', { count: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const remote = turso.db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?').get('student');
  assert.equal(remote.n, 3);
  await stopServer();
});

test('الإيقاف المنظم يرسل الكتابات المعلقة قبل الخروج', async () => {
  await startServer();
  const t = client();
  await t('POST', '/api/auth/teacher', { password: 'pw-12345678' });
  const sid = (await t('GET', '/api/teacher/overview')).data.students[0].id;
  assert.equal((await t('POST', '/api/teacher/notes', { studentId: sid, note: 'ملاحظة قبل الإيقاف مباشرة', visibleToStudent: true })).status, 200);
  await stopServer();
  const n = turso.db.prepare("SELECT COUNT(*) AS n FROM teacher_notes WHERE note = 'ملاحظة قبل الإيقاف مباشرة'").get();
  assert.equal(n.n, 1);
});
