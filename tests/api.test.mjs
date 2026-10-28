// اختبارات تكامل لواجهات الخادم: تشغّل خادمًا حقيقيًا بقاعدة بيانات مؤقتة، ومزود نموذج وهمي محلي لاختبار مسار الذكاء الاصطناعي.
// التشغيل: npm run build && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tasmiyati-test-'));
let server, mock, mockPort, lastMockRequest = null, lastMockMeta = null, mockMode = 'chat';

class Client {
  cookie = '';
  async req(method, url, body) {
    const res = await fetch(BASE + url, {
      method, headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b) { return this.req('PUT', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
}

const teacher = new Client();
const s1 = new Client();
const s2 = new Client();
let codes;

before(async () => {
  // مزود نموذج وهمي متوافق مع OpenAI
  mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      lastMockRequest = JSON.parse(b);
      lastMockMeta = { url: req.url, auth: req.headers.authorization };
      const content = mockMode === 'feedback'
        ? JSON.stringify({ criteria: [{ id: 'c2', observation: 'الموضوع ما زال واسعًا.', where: 'الرياضة', question: 'ما الجانب الذي تريدين التركيز عليه؟' }], strength: 'حددتِ المجال بوضوح.', nextStep: 'ضيّقي الموضوع.' })
        : 'ردّ من النموذج الوهمي: ما المشكلة التي واجهت سارة؟';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  mockPort = mock.address().port;

  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', process.env.SERVER_JS || 'dist/server.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, TEACHER_PASSWORD: 'test-pass-123', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', GEMINI_BASE_URL: `http://localhost:${mockPort}/gemini/v1beta/openai` },
    stdio: 'pipe',
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    server.stdout.on('data', (d) => { if (String(d).includes('يعمل على')) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', (d) => process.stderr.write(d));
  });
  assert.equal((await teacher.post('/api/auth/teacher', { password: 'test-pass-123' })).status, 200);
  codes = (await teacher.post('/api/teacher/students', { count: 2, prefix: 'TT', group: 'أ' })).data.created;
  await teacher.patch('/api/teacher/lessons/L01', { enabled: true, reviewed: true });
  assert.equal((await s1.post('/api/auth/student', { code: codes[0].code })).status, 200);
  assert.equal((await s2.post('/api/auth/student', { code: codes[1].code.toLowerCase() })).status, 200);
});

after(() => { server?.kill(); mock?.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('الصلاحيات: الطالبة لا تصل إلى لوحة المعلمة، والزائر لا يصل إلى البيانات', async () => {
  assert.equal((await s1.get('/api/teacher/overview')).status, 403);
  assert.equal((await s1.get('/api/teacher/export.csv')).status, 403);
  assert.equal((await new Client().get('/api/portfolio')).status, 401);
  assert.equal((await new Client().post('/api/auth/student', { code: 'WRONG' })).status, 401);
});

// ---------- ملء عام لحقول أي مهمة بحسب تعريفها (لاختبار المسار دون الارتباط بنص بعينه) ----------
const defs = {};
async function act(c, id) {
  const L = `L0${id.split('-')[0]}`;
  defs[L] ??= (await c.get(`/api/lessons/${L}`)).data.lesson;
  return defs[L].activities.find((a) => a.id === id);
}
function fill(f) {
  const optId = (o) => (typeof o === 'string' ? o : o.id);
  switch (f.type) {
    case 'text': return 'نص تجريبي';
    case 'textarea': {
      if (f.defaultValue != null) return f.defaultValue + ' (معدّل)';
      const words = Math.max(f.minWords ?? 0, 5);
      const para = Array.from({ length: words }, () => 'كلمة').join(' ');
      return Array.from({ length: Math.max(f.minParagraphs ?? 1, 1) }, () => para).join('\n\n');
    }
    case 'choice': case 'select': return optId(f.options[0]);
    case 'multi': return f.options.slice(0, Math.max(f.min ?? 1, 1)).map(optId);
    case 'classify': return Object.fromEntries(f.items.map((it) => [it.id, f.categories[0].id]));
    case 'ordering': return f.items.map((i) => i.id);
    case 'list': return Array.from({ length: Math.max(f.min ?? 1, 1) }, (_, i) => `عنصر ${i + 1}`);
    case 'outline': return Array.from({ length: Math.max(f.min ?? 1, 1) }, (_, i) => `${i + 1}. فكرة ${i + 1}\n   - تفصيل`).join('\n');
    case 'planner': return JSON.stringify({ mode: f.plannerModes?.[0] ?? 'table', topic: 'موضوع', ideas: Array.from({ length: Math.max(f.min ?? 1, 1) }, (_, i) => ({ element: 'العرض', idea: `فكرة ${i + 1}`, details: ['تفصيل'], method: '' })) });
    case 'table': return Object.fromEntries(f.rows.map((r) => [r.id, Object.fromEntries(f.columns.map((col) => [col.id, (r.options ?? col.options)?.[0] ?? `خلية ${r.id}`]))]));
    default: return 'نص';
  }
}
function values(a, over = {}) {
  const v = {};
  for (const s of a.worksheet.sections) for (const f of s.fields) v[f.id] = fill(f);
  return { ...v, ...over };
}
async function doTask(c, id, over = {}) {
  const a = await act(c, id);
  if (a.independent) {
    const r = await c.post(`/api/activities/${id}/submit`, { values: values(a, over), meta: { pasteCount: 1 } });
    assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.data)}`);
    return r;
  }
  await c.put(`/api/activities/${id}/responses`, { values: values(a, over) });
  const r = await c.post(`/api/activities/${id}/complete`);
  assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.data)}`);
  return r;
}

test('نسخة الطالبة لا تتضمن مفاتيح الإجابة ولا تعليمات المساعد الداخلية، والحصة الأولى من الكتاب بمراحلها', async () => {
  const r = await s1.get('/api/lessons/L01');
  assert.equal(r.status, 200);
  const raw = JSON.stringify(r.data);
  assert.ok(!raw.includes('answerKey'));
  assert.ok(!raw.includes('optionFeedback'));
  assert.ok(!raw.includes('constraints'));
  assert.ok(!raw.includes('teacherProcedures'));
  const l = r.data.lesson;
  assert.equal(l.title, 'مدخل الوحدة');
  assert.equal(l.courseLesson.title, 'خطوات بناء الموضوع');
  assert.deepEqual(l.activities.map((a) => a.id), ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-H']);
  assert.deepEqual(l.activities.map((a) => (a.homework ? 'H' : a.stage)), [1, 1, 2, 3, 4, 5, 6, 7, 'H']);
  assert.ok(l.activities.every((a) => a.book?.pages), 'كل مهمة مرتبطة بصفحات الكتاب');
  assert.equal(l.activities[0].title, 'دليل الوحدة');
  assert.ok(l.activities[1].book.test, 'الاختبار القبلي');
  assert.ok(l.activities[6].independent);
  assert.ok(raw.includes('تتبعي الخطوات المناسبة عند كتابة موضوع أو بحث.'), 'نص الكتاب');
  assert.equal(l.rubric.levels.map((x) => x.label).join('|'), 'متحقق|يحتاج إلى تحسين');
  assert.equal(r.data.statuses['1-1'], 'available');
  assert.equal(r.data.statuses['1-2'], 'locked');
});

test('الحصة غير المتاحة مغلقة أمام الطالبة', async () => {
  assert.equal((await s1.get('/api/lessons/L02')).status, 403);
});

test('ضبط الانتقال، والمساعد متوقف في الاختبار القبلي', async () => {
  assert.equal((await s1.get('/api/activities/1-2')).status, 403);
  const c = await s1.post('/api/activities/1-1/complete');
  assert.equal(c.status, 400);
  assert.ok(c.data.missing.length >= 1);
  await doTask(s1, '1-1');
  const k = await s1.get('/api/activities/1-2');
  assert.equal(k.status, 200);
  assert.equal(k.data.chatBlocked, 'independent');
  assert.equal((await s1.post('/api/activities/1-2/chat', { message: 'ساعديني' })).status, 423);
  await doTask(s1, '1-2');
  assert.equal((await s1.get('/api/activities/1-3')).status, 200);
});

test('الوضع التجريبي يعرض الأسئلة بالتتابع ويُوسم بأنه غير متصل بالنموذج', async () => {
  const r1 = await s2.post('/api/activities/1-1/chat', { message: 'مرحبًا' });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.mode, 'demo');
  assert.ok(r1.data.reply.includes('أي موضوعات الوحدة الثلاثة'));
  const r2 = await s2.post('/api/activities/1-1/chat', { message: 'الثاني' });
  assert.ok(r2.data.reply.includes('أي الأهداف التدريبية'));
});

test('أزرار المساعد المسماة ترسل تعليمتها إلى سياق المساعد دون أن تظهر للطالبة', async () => {
  const a = await act(s1, '1-3');
  assert.equal(a.worksheet.sections[0].assist.label, 'راجعي إجابتي معي');
  assert.equal(a.worksheet.sections[0].assist.message, '');
  const r = await s1.post('/api/activities/1-3/chat', { message: '«راجعي إجابتي معي»', assist: 's1' });
  assert.equal(r.status, 200);
  const chat = (await s1.get('/api/activities/1-3')).data.chat;
  assert.equal(chat.at(-2).content, '«راجعي إجابتي معي»');
});

test('الجدول بخلايا معطاة من الكتاب: الصف المعطى لا يُطلب، والناقص يمنع الإكمال', async () => {
  await doTask(s1, '1-3');
  await doTask(s1, '1-4');
  await doTask(s1, '1-5');
  const a = await act(s1, '1-6');
  const genres = a.worksheet.sections[0].fields.find((f) => f.id === 'genres');
  assert.ok(genres.given.r1.c1.includes('عنوان (قصير ومثير ودال على المحتوى)'));
  await s1.put('/api/activities/1-6/responses', { values: { genres: { r2: { c1: 'الشخصيات' }, r3: { c1: 'التحية' } } } });
  assert.equal((await s1.post('/api/activities/1-6/complete')).status, 400, 'صف التقرير فارغ');
  await s1.put('/api/activities/1-6/responses', { values: { genres: { r2: { c1: 'الشخصيات' }, r3: { c1: 'التحية' }, r4: { c1: 'النتائج' } } } });
  assert.equal((await s1.post('/api/activities/1-6/complete')).status, 200);
});

test('الإنتاج المستقل: منع برمجي للتوليد، وحفظ النسخة الأصلية مع وقت التسليم، وعدم تعديلها', async () => {
  assert.equal((await s1.post('/api/activities/1-6/chat', { message: 'قبل البدء' })).status, 200, 'المساعد يعمل قبل فتح الإنتاج المستقل');
  await s1.post('/api/activities/1-7/open');
  assert.equal((await s1.post('/api/activities/1-7/chat', { message: 'اكتبي لي' })).status, 423);
  assert.equal((await s1.post('/api/activities/1-6/chat', { message: 'اكتبي لي' })).status, 423, 'التوليد معطل في كل مهمات الحصة أثناء الإنتاج المستقل');
  assert.equal((await s1.get('/api/activities/1-6')).data.chatBlocked, 'independent_lesson');
  assert.equal((await s1.post('/api/activities/1-7/submit', { values: { srcTopics: { r1: { c1: 'أ' } } } })).status, 400);
  const ok = await doTask(s1, '1-7', { srcTopics: { r1: { c1: 'إحدى التجارب' }, r2: { c1: 'الحاسوب' }, r3: { c1: 'العمران' }, r4: { c1: 'النثر' }, r5: { c1: 'رعاية الفقراء' } } });
  assert.ok(ok.data.meta.submittedAt);
  assert.equal((await s1.put('/api/activities/1-7/responses', { values: { srcTopics: {} } })).status, 409);
  assert.equal((await s1.post('/api/activities/1-7/submit', { values: {} })).status, 409);
  assert.equal((await s1.post('/api/activities/1-6/chat', { message: 'بعد التسليم' })).status, 200, 'يعود المساعد بعد التسليم');
});

test('التقويم والتحسين بمستويين: التقويم الذاتي أولًا، ثم الملاحظات، ثم النسخة المحسنة مع الاحتفاظ بالأصلية', async () => {
  const ev = await act(s1, '1-8');
  assert.equal(ev.evaluation.analyzeLabel, 'تحليل موضوعاتي المقترحة');
  assert.equal(ev.evaluation.sourceActivity, '1-7');
  assert.equal((await s1.post('/api/activities/1-8/feedback')).status, 400, 'لا ملاحظات قبل التقويم الذاتي');
  assert.equal((await s1.put('/api/activities/1-8/revised', { values: {} })).status, 400);
  const ratings = { c1: { level: 'met' }, c2: { level: 'needs', note: 'عامّ' } };
  let r = await s1.put('/api/activities/1-8/self-assessment', { ratings });
  assert.equal(r.data.complete, false);
  r = await s1.put('/api/activities/1-8/self-assessment', { ratings: { ...ratings, c3: { level: 'partial' } } });
  assert.equal(r.data.complete, false, 'المستوى غير المعتمد يُرفض');
  r = await s1.put('/api/activities/1-8/self-assessment', { ratings: { ...ratings, c3: { level: 'met' } } });
  assert.equal(r.data.complete, true);
  const fb = await s1.post('/api/activities/1-8/feedback');
  assert.equal(fb.status, 503);
  assert.equal(fb.data.kind, 'demo');
  assert.equal((await s1.post('/api/activities/1-8/complete')).status, 400, 'النسخة المحسنة مطلوبة');
  r = await s1.put('/api/activities/1-8/revised', { values: { srcTopics: { r1: { c1: 'تجربة تفاعل كيميائي في مختبر المدرسة' }, r2: { c1: 'الحاسوب' }, r3: { c1: 'العمران' }, r4: { c1: 'النثر' }, r5: { c1: 'رعاية الفقراء' } } } });
  assert.equal(r.status, 200);
  assert.equal((await s1.post('/api/activities/1-8/complete')).status, 200);
  // النشاط المنزلي بعد المراحل السبع
  assert.equal((await s1.get('/api/activities/1-H')).status, 200);
  assert.equal((await s1.post('/api/activities/1-H/complete')).status, 400);
  await doTask(s1, '1-H');
  const p = await s1.get('/api/portfolio');
  const l1 = p.data.lessons.find((l) => l.id === 'L01');
  assert.equal(l1.completed, true);
  assert.equal(JSON.parse(l1.product.initial.srcTopics).r1.c1, 'إحدى التجارب');
  assert.ok(JSON.parse(l1.product.revised.srcTopics).r1.c1.startsWith('تجربة تفاعل'));
  assert.ok(p.data.skills.find((s) => s.id === 1));
  assert.ok(!JSON.stringify(p.data).includes('chatCount'));
  assert.ok(String((await s1.get('/api/portfolio/export')).data).includes('ملف إنجازي الكتابي'));
});

test('عزل البيانات: الطالبة لا ترى أعمال زميلتها إلا ما اعتمدته المعلمة', async () => {
  await teacher.patch('/api/teacher/lessons/L02', { enabled: true, reviewed: true });
  for (const id of ['2-1', '2-2', '2-3']) await doTask(s1, id);
  await s1.put('/api/activities/2-4/responses', { values: values(await act(s1, '2-4'), { peerPrefsShow: 'المقال أولًا ثم القصة' }) });
  const sh = await s1.post('/api/activities/2-4/share', {});
  assert.equal(sh.status, 200);
  const shares = await teacher.get('/api/teacher/shares');
  const share = shares.data.shares[0];
  assert.ok(JSON.stringify(share.content).includes('المقال أولًا ثم القصة'));
  assert.ok(JSON.stringify(share.content).includes('عدد الزميلات اللاتي يفضلنه'), 'الجدول يُشارك نصًّا مقروءًا');
  const st2 = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[1].code);
  await teacher.post(`/api/teacher/students/${st2.id}/unlock`, { activityId: '2-4' });
  let g = await s2.get('/api/activities/2-4/gallery');
  assert.equal(g.data.items.length, 0, 'لا يظهر قبل الاعتماد');
  await teacher.patch(`/api/teacher/shares/${share.id}`, { status: 'approved', scope: 'class' });
  g = await s2.get('/api/activities/2-4/gallery');
  assert.equal(g.data.items.length, 1);
  assert.ok(g.data.items[0].author.startsWith('زميلة'));
  await s2.post(`/api/shares/${share.id}/comments`, { text: 'أعجبتني نتائجكِ' });
  g = await s1.get('/api/activities/2-4/gallery');
  assert.equal(g.data.items[0].comments.length, 0);
});

test('لوحة المعلمة: المتابعة، والفتح الاستثنائي، والتصدير', async () => {
  const o = await teacher.get('/api/teacher/overview');
  assert.equal(o.data.students.length, 2);
  const st2 = o.data.students.find((s) => s.code === codes[1].code);
  assert.equal(st2.progress.L01['1-3'], 'locked');
  await teacher.post(`/api/teacher/students/${st2.id}/unlock`, { activityId: '1-3' });
  assert.equal((await s2.get('/api/activities/1-3')).status, 200);
  const csv = await teacher.get('/api/teacher/export.csv');
  assert.ok(String(csv.data).includes(codes[0].code));
  assert.ok(String(csv.data).includes('المنتج المحسن'));
  const st1 = o.data.students.find((s) => s.code === codes[0].code);
  const detail = await teacher.get(`/api/teacher/students/${st1.id}`);
  assert.equal(detail.data.lessons[0].initial.meta.pasteCount, 1);
});

test('المعلمة تعدّل تعليمات المساعد والمعايير دون تعديل الشيفرة', async () => {
  assert.equal((await teacher.put('/api/teacher/activities/1-1/assistant', { name: 'رفيقتي في الكتابة', extraInstructions: 'استخدمي أمثلة من المدرسة.' })).status, 200);
  const l = await s2.get('/api/lessons/L01');
  assert.equal(l.data.lesson.activities.find((a) => a.id === '1-1').assistant.name, 'رفيقتي في الكتابة');
  await teacher.req('DELETE', '/api/teacher/activities/1-1/assistant');
  assert.equal((await teacher.put('/api/teacher/lessons/L01/rubric', { criteria: [{ id: 'c1', text: 'معيار معدل' }] })).status, 200);
  const r = await teacher.get('/api/teacher/content');
  assert.equal(r.data.lessons[0].rubric.criteria.length, 1);
  await teacher.req('DELETE', '/api/teacher/lessons/L01/rubric');
});

test('ربط النموذج عبر الخادم: التعليمات تُبنى من نص الكتاب وبيانات المهمة، والمفتاح لا يصل إلى المتصفح', async () => {
  mockMode = 'chat';
  const set = await teacher.put('/api/teacher/settings', { ai: { provider: 'openai', baseUrl: `http://localhost:${mockPort}/v1`, model: 'mock-model', apiKey: 'sk-secret-key-1234', enabled: true } });
  assert.equal(set.data.ai.keyConfigured, true);
  assert.ok(!JSON.stringify(set.data).includes('sk-secret'));
  assert.equal(set.data.ai.keyHint, '…1234');
  const r = await s2.post('/api/activities/1-1/chat', { message: 'أريد أن أتعلم كتابة المقال' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'ai');
  const sys = lastMockRequest.messages[0].content;
  assert.ok(sys.includes('رفيقة التحفيز'));
  assert.ok(sys.includes('التحفيز الذكي'));
  assert.ok(sys.includes('(1‏-‏1): دليل الوحدة'));
  assert.ok(sys.includes('تتبعي الخطوات المناسبة عند كتابة موضوع أو بحث.'), 'نص الكتاب في سياق المساعد');
  assert.ok(sys.includes('خاطبيها بصيغة المؤنث'));
  assert.ok(sys.includes('تحديد موضوع الكتابة ومجاله تحديدًا دقيقًا.'));
  assert.ok(sys.includes('الكفاءة: الثقة بالقدرة على تعلم مهارات الكتابة وفهمها.'));
  assert.equal(lastMockRequest.messages.at(-1).content, 'أريد أن أتعلم كتابة المقال');
  // زر مسمى: تعليمته في السياق
  await s1.post('/api/activities/1-3/chat', { message: '«راجعي إجابتي معي»', assist: 's1' });
  assert.ok(lastMockRequest.messages[0].content.includes('ضغطت الطالبة زر «راجعي إجابتي معي»'));
  assert.ok(!JSON.stringify(await s2.get('/api/me')).includes('sk-secret'));
});

test('التغذية الراجعة الذكية تُحلَّل وفق المعايير وتُحفظ، والمعلمة تراجعها', async () => {
  mockMode = 'feedback';
  const fb = await s1.post('/api/activities/1-8/feedback');
  assert.equal(fb.status, 200);
  assert.equal(fb.data.data.criteria[0].id, 'c2');
  assert.ok(lastMockRequest.messages[0].content.includes('لا تقترحي صياغة بديلة'));
  assert.ok(lastMockRequest.messages[1].content.includes('تقويمها الذاتي'));
  assert.ok(lastMockRequest.messages[1].content.includes('يحتاج إلى تحسين'));
  const a = await s1.get('/api/activities/1-8');
  assert.equal(a.data.evaluation.feedback.length, 1);
});

test('ربط Gemini: عنوان الخدمة ثابت، والمفتاح عبر الخادم، والنموذج الافتراضي مناسب', async () => {
  mockMode = 'chat';
  const set = await teacher.put('/api/teacher/settings', { ai: { provider: 'gemini', model: 'mock-model', apiKey: 'AIza-gemini-key-9876', enabled: true } });
  assert.equal(set.data.ai.provider, 'gemini');
  assert.equal(set.data.ai.model, 'gemini-3.8-flash');
  assert.ok(set.data.ai.baseUrl.startsWith('https://generativelanguage.googleapis.com/'));
  assert.ok(!JSON.stringify(set.data).includes('AIza-gemini'));
  const r = await s2.post('/api/activities/1-1/chat', { message: 'سؤال إلى Gemini' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'ai');
  assert.equal(lastMockMeta.url, '/gemini/v1beta/openai/chat/completions');
  assert.equal(lastMockMeta.auth, 'Bearer AIza-gemini-key-9876');
  assert.equal(lastMockRequest.model, 'gemini-3.8-flash');
  assert.equal(lastMockRequest.reasoning_effort, 'low');
  assert.ok(lastMockRequest.messages[0].content.includes('رفيقة التحفيز'));
  const back = await teacher.put('/api/teacher/settings', { ai: { provider: 'openai', baseUrl: `http://localhost:${mockPort}/v1`, model: 'mock-model', apiKey: 'sk-secret-key-1234' } });
  assert.equal(back.data.ai.keyHint, '…1234');
});

test('فشل الاتصال بالنموذج يعطي رسالة واضحة ولا يضيع شيئًا', async () => {
  await teacher.put('/api/teacher/settings', { ai: { baseUrl: 'http://localhost:1/v1' } });
  const before = (await s2.get('/api/activities/1-1')).data.chat.length;
  const r = await s2.post('/api/activities/1-1/chat', { message: 'رسالة أثناء الانقطاع' });
  assert.equal(r.status, 502);
  assert.ok(r.data.error.includes('تعذّر الاتصال'));
  assert.equal((await s2.get('/api/activities/1-1')).data.chat.length, before);
  const t = await teacher.post('/api/teacher/ai/test');
  assert.equal(t.data.ok, false);
  await teacher.put('/api/teacher/settings', { ai: { clearKey: true, provider: 'anthropic', model: 'claude-sonnet-5-5' } });
  assert.equal((await s2.post('/api/activities/1-1/chat', { message: 'عاد الوضع التجريبي' })).data.mode, 'demo');
});

test('حذف بيانات طالبة يزيل كل سجلاتها', async () => {
  const o = await teacher.get('/api/teacher/overview');
  const st = o.data.students.find((s) => s.code === codes[1].code);
  assert.equal((await teacher.req('DELETE', `/api/teacher/students/${st.id}`)).status, 200);
  assert.equal((await s2.get('/api/portfolio')).status, 401);
  const json = await teacher.get('/api/teacher/export.json');
  assert.ok(!JSON.stringify(json.data).includes(codes[1].code));
});

test('الحصة الثانية: المطابقة والترتيب يُفحصان آليًّا، والإنتاج المستقل جدولًا، والاعتماد', async () => {
  const pr = await s1.get('/api/products');
  assert.equal(pr.data.products.find((p) => p.lessonId === 'L01').version, 'revised');
  // 2-2: المطابقة لا تُفحص قبل اكتمالها، ثم صفًّا صفًّا؛ والترتيب موضعًا موضعًا (أُكملت قبل اختبار المشاركة، والفحص يعمل بعد الإكمال أيضًا)
  let r = await s1.put('/api/activities/2-2/responses', { values: { stepMatch: { i1: 'k6', i2: 'k3' } } });
  assert.equal(r.data.checks.stepMatch, undefined);
  r = await s1.put('/api/activities/2-2/responses', { values: { stepMatch: { i1: 'k6', i2: 'k3', i3: 'k7', i4: 'k2', i5: 'k5', i6: 'k1', i7: 'k1' } } });
  assert.deepEqual(r.data.checks.stepMatch.detail, [true, true, true, true, true, true, false]);
  r = await s1.put('/api/activities/2-2/responses', { values: { stepOrder: ['s4', 's6', 's2', 's5', 's7', 's1', 's3'] } });
  assert.equal(r.data.checks.stepOrder.correct, true);
  await doTask(s1, '2-4');
  await doTask(s1, '2-5');
  const goals = { r1: { c1: 'إطلاع الوزير على سير العمل' }, r2: { c1: 'السلام' } };
  assert.equal((await s1.post('/api/activities/2-6/submit', { values: { goals } })).status, 400, 'أهداف ناقصة');
  await doTask(s1, '2-6', { goals: { ...goals, r3: { c1: 'التحذير' }, r4: { c1: 'التوعية' }, r5: { c1: 'التبيين' } } });
  const p2 = (await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L02');
  assert.equal(p2.version, 'initial');
  assert.equal(JSON.parse(p2.data.goals).r1.c1, 'إطلاع الوزير على سير العمل');
  const csv = String((await teacher.get('/api/teacher/export.csv')).data);
  assert.ok(csv.includes('إطلاع الوزير على سير العمل'), 'الجدول يُصدَّر نصًّا مقروءًا');
  const st = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[0].code);
  assert.equal((await teacher.post(`/api/teacher/students/${st.id}/approve`, { lessonId: 'L02' })).status, 200);
  assert.ok((await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L02').approvedAt);
  const html = String((await s1.get('/api/portfolio/export')).data);
  assert.ok(html.includes('إطلاع الوزير على سير العمل') && !html.includes('{&quot;'));
});

test('أداة المخطط: شجرة الذاكرة تُحفظ نصًّا منظمًا وتُتحقق من اكتمالها', async () => {
  for (const id of ['L03', 'L04']) await teacher.patch(`/api/teacher/lessons/${id}`, { enabled: true, reviewed: true });
  const st = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[0].code);
  await teacher.post(`/api/teacher/students/${st.id}/unlock`, { activityId: '4-6' });
  const plan = { mode: 'tree', topic: 'اهتمام الملك سلمان بالحرمين', ideas: [{ element: '', idea: 'التوسعة', details: ['المسجد الحرام'], method: '' }, { element: '', idea: 'العناية بالحجاج', details: [] }] };
  assert.equal((await s1.post('/api/activities/4-6/submit', { values: { treeHaram: JSON.stringify(plan) } })).status, 400, 'فكرتان فقط');
  plan.ideas.push({ element: '', idea: 'النظافة', details: [] }, { element: '', idea: 'الإضاءة', details: [] });
  plan.mode = 'nonsense';
  assert.equal((await s1.post('/api/activities/4-6/submit', { values: { treeHaram: JSON.stringify(plan) } })).status, 400, 'شكل التخطيط مطلوب');
  plan.mode = 'tree';
  assert.equal((await s1.post('/api/activities/4-6/submit', { values: { treeHaram: JSON.stringify(plan) } })).status, 200);
  const p4 = (await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L04');
  assert.equal(JSON.parse(p4.data.treeHaram).mode, 'tree');
});

test('الأسماء: تضيفها المعلمة، وتراها الطالبة نفسها فقط، ولا تصل إلى النموذج ولا إلى التصدير إلا باختيار', async () => {
  const r = await teacher.post('/api/teacher/students', { names: ['لمى زيدان', '  ', 'ريم خالد'], prefix: 'NM' });
  assert.equal(r.data.created.length, 2);
  assert.equal(r.data.created[0].name, 'لمى زيدان');
  assert.match(r.data.created[0].label, /^طالبة \d+$/);
  const st = new Client();
  await st.post('/api/auth/student', { code: r.data.created[0].code });
  assert.equal((await st.get('/api/me')).data.user.name, 'لمى زيدان');
  // لا يظهر الاسم في سياق النموذج
  mockMode = 'chat';
  await teacher.put('/api/teacher/settings', { ai: { provider: 'openai', baseUrl: `http://localhost:${mockPort}/v1`, model: 'mock-model', apiKey: 'sk-secret-key-1234', enabled: true } });
  await st.post('/api/activities/1-1/chat', { message: 'مرحبًا' });
  assert.ok(!JSON.stringify(lastMockRequest).includes('زيدان'));
  await teacher.put('/api/teacher/settings', { ai: { clearKey: true, provider: 'anthropic', model: 'claude-sonnet-5-5' } });
  // التصدير دون أسماء افتراضيًا، وبها عند الطلب
  assert.ok(!String((await teacher.get('/api/teacher/export.csv')).data).includes('لمى زيدان'));
  assert.ok(String((await teacher.get('/api/teacher/export.csv?names=1')).data).includes('لمى زيدان'));
  // تعديل الاسم وحذفه
  const id = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === r.data.created[1].code).id;
  await teacher.patch(`/api/teacher/students/${id}`, { name: 'ريم خالد علي' });
  assert.equal((await teacher.get(`/api/teacher/students/${id}`)).data.student.name, 'ريم خالد علي');
  await teacher.patch(`/api/teacher/students/${id}`, { name: '' });
  assert.equal((await teacher.get(`/api/teacher/students/${id}`)).data.student.name, null);
});

test('سلالم التقدير: بنود من المهارات المعتمدة، وحفظ وتعديل، ومستويات قابلة للتغيير، وتصدير', async () => {
  const sheet = await teacher.get('/api/teacher/ratings/1-1');
  assert.equal(sheet.status, 200);
  assert.equal(sheet.data.scale.length, 4);
  assert.ok(sheet.data.criteria.some((c) => c.text === 'تحديد موضوع الكتابة ومجاله تحديدًا دقيقًا.'));
  const sid = sheet.data.students[0].id;
  const [c1, c2] = sheet.data.criteria;
  let r = await teacher.put(`/api/teacher/students/${sid}/ratings`, { activityId: '1-1', values: { [c1.id]: 4, [c2.id]: 2, bogus: 3 }, note: 'تحتاج دعمًا في الهدف' });
  assert.deepEqual(r.data.values, { [c1.id]: 4, [c2.id]: 2 });
  assert.equal(r.data.note, 'تحتاج دعمًا في الهدف');
  r = await teacher.put(`/api/teacher/students/${sid}/ratings`, { activityId: '1-1', values: { [c2.id]: null, [c1.id]: 9 } });
  assert.deepEqual(r.data.values, { [c1.id]: 4 }); // مستوى غير موجود يُرفض، وnull يمحو
  // الإنتاج المستقل يستخدم معايير الحصة
  const ind = await teacher.get('/api/teacher/ratings/1-7');
  assert.ok(ind.data.criteria[0].id.startsWith('r-'));
  // تعديل البنود ثم الاستعادة
  await teacher.put('/api/teacher/activities/1-1/scale', { criteria: [{ id: c1.id, text: 'بند معدّل' }, { text: 'بند جديد' }] });
  const edited = await teacher.get('/api/teacher/ratings/1-1');
  assert.equal(edited.data.custom, true);
  assert.equal(edited.data.criteria.length, 2);
  assert.equal(edited.data.students.find((s) => s.id === sid).values[c1.id], 4);
  await teacher.req('DELETE', '/api/teacher/activities/1-1/scale');
  // المستويات
  const sc = await teacher.put('/api/teacher/settings', { scale: ['متقن', 'متمكن', 'مبتدئ'] });
  assert.deepEqual(sc.data.scale.map((x) => x.value), [3, 2, 1]);
  assert.equal((await teacher.put('/api/teacher/settings', { scale: ['واحد'] })).status, 400);
  await teacher.put('/api/teacher/settings', { scale: null });
  // يظهر في صفحة الطالبة والتصدير، ولا يصل إلى الطالبة
  const det = await teacher.get(`/api/teacher/students/${sid}`);
  assert.equal(det.data.lessons[0].activities.find((a) => a.id === '1-1').rating.values[c1.id], 4);
  const csv = String((await teacher.get('/api/teacher/export-ratings.csv')).data);
  assert.ok(csv.includes('ممتاز') && csv.includes('تحتاج دعمًا في الهدف'));
  assert.ok(!JSON.stringify((await s1.get('/api/activities/1-1')).data).includes('تحتاج دعمًا في الهدف'));
  // الطالبة لا تصل إلى واجهات التقدير
  assert.equal((await s1.get('/api/teacher/ratings/1-1')).status, 403);
});

test('التصفير: يتطلب كلمة المرور والتأكيد، ويُبقي المحتوى والإعدادات', async () => {
  assert.equal((await teacher.post('/api/teacher/reset', { mode: 'work', password: 'test-pass-123', confirm: 'نعم' })).status, 400);
  assert.equal((await teacher.post('/api/teacher/reset', { mode: 'work', password: 'خطأ', confirm: 'تصفير' })).status, 400);
  assert.equal((await s1.post('/api/teacher/reset', { mode: 'all', password: 'test-pass-123', confirm: 'تصفير' })).status, 403);
  await teacher.put('/api/teacher/activities/1-2/assistant', { extraInstructions: 'تبقى بعد التصفير' });
  const before = (await teacher.get('/api/teacher/overview')).data.students.length;
  assert.equal((await teacher.post('/api/teacher/reset', { mode: 'work', password: 'test-pass-123', confirm: 'تصفير' })).status, 200);
  const o = await teacher.get('/api/teacher/overview');
  assert.equal(o.data.students.length, before);
  assert.ok(o.data.students.every((s) => Object.values(s.progress.L01).every((x) => x !== 'completed')));
  assert.equal((await s1.get('/api/activities/1-1')).status, 200); // الطالبة ما زالت تستطيع الدخول
  assert.equal(String((await teacher.get('/api/teacher/export-ratings.csv')).data).split('\r\n').length, 1);
  assert.equal((await teacher.post('/api/teacher/reset', { mode: 'all', password: 'test-pass-123', confirm: 'تصفير' })).status, 200);
  assert.equal((await teacher.get('/api/teacher/overview')).data.students.length, 0);
  assert.equal((await s1.get('/api/activities/1-1')).status, 401);
  const content = await teacher.get('/api/teacher/content');
  assert.ok(JSON.stringify(content.data).includes('تبقى بعد التصفير'));
  await teacher.req('DELETE', '/api/teacher/activities/1-2/assistant');
});

test('التقارير: صورة الصف وتقرير الطالبة من تقديرات المعلمة فقط', async () => {
  const made = (await teacher.post('/api/teacher/students', { names: ['أولى', 'ثانية'] })).data.created;
  const ov = (await teacher.get('/api/teacher/overview')).data.students;
  const [a, b] = made.map((m) => ov.find((s) => s.code === m.code).id);
  const st = new Client();
  await st.post('/api/auth/student', { code: made[0].code });
  await st.post('/api/activities/1-1/open'); // تفتح النشاط
  const crit = (await teacher.get('/api/teacher/ratings/1-1')).data.criteria;
  await teacher.put(`/api/teacher/students/${a}/ratings`, { activityId: '1-1', values: { [crit[0].id]: 4, [crit[1].id]: 4 } });
  await teacher.put(`/api/teacher/students/${b}/ratings`, { activityId: '1-1', values: { [crit[0].id]: 2, [crit[1].id]: 1 } });
  const c = (await teacher.get('/api/teacher/analytics')).data;
  assert.equal(c.totals.students, 2);
  assert.equal(c.totals.ratingsCount, 4);
  assert.equal(c.totals.avgRating, 2.75);
  assert.equal(c.lessonRatings[0].avg, 2.75);
  assert.equal(c.lessonRatings[1].avg, null);
  assert.equal(c.lessonProgress[0].inProgress + c.lessonProgress[0].notStarted + c.lessonProgress[0].completed, 2);
  const skill1 = c.skillRatings.find((k) => k.id === 1);
  assert.equal(skill1.avg, 3); // البند الأول مرتبط بالمهارة 1: (4+2)/2
  assert.equal(c.distribution.find((x) => x.value === 4).count, 2);
  const sa = (await teacher.get(`/api/teacher/analytics/student/${a}`)).data;
  assert.equal(sa.summary.avgRating, 4);
  assert.equal(sa.summary.classAvg, 2.75);
  assert.equal(sa.timeline[0].avg, 4);
  assert.ok(sa.timeline[0].openedAt);
  assert.ok(sa.strengths.some((k) => k.id === 1));
  const sb = (await teacher.get(`/api/teacher/analytics/student/${b}`)).data;
  assert.ok(sb.needs.length >= 1);
  assert.equal((await st.get('/api/teacher/analytics')).status, 403);
});
