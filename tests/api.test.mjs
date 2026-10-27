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

test('نسخة الطالبة لا تتضمن مفاتيح الإجابة ولا التغذية الراجعة للبدائل ولا تعليمات المساعد الداخلية', async () => {
  const r = await s1.get('/api/lessons/L01');
  assert.equal(r.status, 200);
  const raw = JSON.stringify(r.data);
  assert.ok(!raw.includes('answerKey'));
  assert.ok(!raw.includes('optionFeedback'));
  assert.ok(!raw.includes('constraints'));
  assert.ok(!raw.includes('teacherProcedures'));
  assert.ok(!raw.includes('أحسنتِ. هذا موضوع محدد ينطلق من المشكلة')); // تغذية راجعة لبديل
  assert.ok(!raw.includes('ولا تقترحي عليها موضوعًا بديلًا')); // تعليمات زر المساعد
  assert.ok(raw.includes('"checkable":true'));
  assert.equal(Object.keys(r.data.statuses).length, 8); // سبع مهمات ونشاط منزلي؛ أنشطة الكتاب العامة خارج الحصص
  assert.equal(r.data.statuses['1-1'], 'available');
  assert.equal(r.data.statuses['1-2'], 'locked');
  const l = r.data.lesson;
  assert.equal(l.title, 'اختيار موضوع الكتابة وتحديد الهدف');
  assert.deepEqual(l.activities.filter((a) => !a.book).map((a) => a.minutes ?? null), [4, 6, 5, 5, 9, 11, 5, null]);
  assert.ok(l.activities[7].homework);
  assert.equal(l.activities[0].worksheet.sections[0].title, 'ساعدي سارة على اتخاذ القرار');
  assert.equal(l.objectives.length, 6);
  assert.equal(l.rubric.levels.map((x) => x.label).join('|'), 'متحقق|يحتاج إلى تحسين');
});

test('الحصة غير المتاحة مغلقة أمام الطالبة', async () => {
  assert.equal((await s1.get('/api/lessons/L02')).status, 403);
});

test('أقسام كتاب الطالبة خارج الحصص: متاحة دون إتاحة، والمساعد متوقف في الاختبارات، والإكمال بالمتطلبات', async () => {
  const cat = (await s1.get('/api/catalog')).data;
  assert.deepEqual(cat.sections.map((x) => x.id), ['UI', 'UD1', 'UD3', 'UO']);
  assert.ok(cat.sections.every((x) => x.enabled));
  assert.equal(cat.lessons.length, 9);
  const l7 = (await s1.get('/api/lessons/UI')).data;
  assert.equal(l7.lesson.kind, 'book');
  for (const k of ['UI-K1', 'UI-K2', 'UI-K3']) assert.equal(l7.statuses[k], 'available');
  const k3 = await s1.get('/api/activities/UI-K3');
  assert.equal(k3.status, 200);
  assert.equal(k3.data.chatBlocked, 'independent');
  assert.equal((await s1.post('/api/activities/UI-K3/chat', { message: 'ساعديني' })).status, 423);
  assert.equal((await s1.post('/api/activities/UI-K1/complete')).status, 400, 'المتطلبات أولًا');
  await s1.put('/api/activities/UI-K1/responses', { values: { unitHope: 'أن أنظم أفكاري قبل الكتابة' } });
  assert.equal((await s1.post('/api/activities/UI-K1/complete')).status, 200);
  // خلايا الجدول المعطاة في الكتاب لا تُطلب من الطالبة
  await s1.put('/api/activities/UD1-K1/responses', { values: { genreFit: { r3: { c1: 'قصة' }, r4: { c1: 'مقال' }, r5: { c1: 'رسالة' } } } });
  const st = (await s1.get('/api/lessons/UI')).data.statuses;
  assert.equal(st['UI-K1'], 'completed');
  const lesson = (await s1.get('/api/lessons/UD1')).data.lesson;
  const k4 = lesson.activities.find((a) => a.id === 'UD1-K1');
  assert.equal(k4.book.pages, '155–157');
  assert.ok(!JSON.stringify(lesson).includes('answerKey'));
});


test('ضبط الانتقال، والفحص الموضوعي بتغذية راجعة لكل بديل', async () => {
  assert.equal((await s1.get('/api/activities/1-2')).status, 403);
  const c = await s1.post('/api/activities/1-1/complete');
  assert.equal(c.status, 400);
  assert.equal(c.data.missing.length, 2);
  let r = await s1.put('/api/activities/1-1/responses', { values: { topic: 'أ' } });
  assert.equal(r.data.checks.topic.correct, false);
  assert.ok(r.data.checks.topic.message.includes('مجال واسع'));
  r = await s1.put('/api/activities/1-1/responses', { values: { topic: 'ب', goal: 'ب' } });
  assert.equal(r.data.checks.topic.correct, true);
  assert.ok(r.data.checks.goal.message.startsWith('إجابة دقيقة'));
  assert.equal((await s1.post('/api/activities/1-1/complete')).status, 200);
  assert.equal((await s1.get('/api/activities/1-2')).status, 200);
});

test('الوضع التجريبي يعرض الأسئلة بالتتابع ويُوسم بأنه غير متصل بالنموذج', async () => {
  const r1 = await s2.post('/api/activities/1-1/chat', { message: 'نعم مستعدة' });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.mode, 'demo');
  assert.ok(r1.data.reply.includes('ما الصعوبة التي واجهت سارة'));
  const r2 = await s2.post('/api/activities/1-1/chat', { message: 'لم تحدد موضوعها' });
  assert.ok(r2.data.reply.includes('لماذا يساعد الموضوع المحدد'));
});

test('المطابقة بالقوائم لا تُفحص قبل اكتمالها، ثم تُفحص صفًّا صفًّا', async () => {
  let r = await s1.put('/api/activities/1-2/responses', { values: { genreMatch: { i1: 'k4', i2: 'k2' } } });
  assert.equal(r.data.checks.genreMatch, undefined);
  r = await s1.put('/api/activities/1-2/responses', { values: { genreMatch: { i1: 'k4', i2: 'k1', i3: 'k3', i4: 'k1' } } });
  assert.deepEqual(r.data.checks.genreMatch.detail, [true, false, true, true]);
  await s1.put('/api/activities/1-2/responses', { values: { genreMatch: { i1: 'k4', i2: 'k2', i3: 'k3', i4: 'k1' }, goal: 'تشجيع الزميلات على القراءة', audience: 'أ', style: 'نعم' } });
  assert.equal((await s1.post('/api/activities/1-2/complete')).status, 200);
  await s1.put('/api/activities/1-3/responses', { values: { relation: 'كل عنصر يحدد ما بعده', better: 'o2', reason: 'أدق' } });
  assert.equal((await s1.post('/api/activities/1-3/complete')).status, 200);
  await s1.put('/api/activities/1-4/responses', { values: { domain: 'الحياة المدرسية', topic: 'الرياضة', topicReviewed: 'الرياضة' } });
  assert.equal((await s1.post('/api/activities/1-4/complete')).status, 200);
  // جدول بطاقة تدريبية بخلية اختيار
  r = await s1.put('/api/activities/1-5/responses', { values: { weak: 'الموضوع', newTopic: 'أثر القراءة', newGoal: 'التشجيع', card: { r1: { c1: 'البيئة' }, r2: { c1: 'الهدر' }, r3: { c1: 'التوعية' }, r4: { c1: 'الطالبات' } }, peerGave: 'جيد', peerNeed: 'o2' } });
  assert.equal((await s1.post('/api/activities/1-5/complete')).status, 400, 'خلية الفن التعبيري فارغة');
  await s1.put('/api/activities/1-5/responses', { values: { card: { r1: { c1: 'البيئة' }, r2: { c1: 'الهدر' }, r3: { c1: 'التوعية' }, r4: { c1: 'الطالبات' }, r5: { c1: 'المقال' } } } });
  assert.equal((await s1.post('/api/activities/1-5/complete')).status, 200);
});

test('أزرار المساعد المسماة في الدليل ترسل تعليمتها إلى سياق المساعد دون أن تظهر للطالبة', async () => {
  const a = await s1.get('/api/activities/1-5');
  assert.equal(a.status, 200);
  const r = await s1.post('/api/activities/1-5/chat', { message: '«فحص اختياراتي»', assist: 'a2' });
  assert.equal(r.status, 200);
  const chat = (await s1.get('/api/activities/1-5')).data.chat;
  assert.equal(chat.at(-2).content, '«فحص اختياراتي»');
});

test('الإنتاج المستقل: منع برمجي للتوليد، وحفظ النسخة الأصلية مع وقت التسليم، وعدم تعديلها', async () => {
  assert.equal((await s1.post('/api/activities/1-5/chat', { message: 'قبل البدء' })).status, 200, 'المساعد يعمل قبل فتح الإنتاج المستقل');
  await s1.post('/api/activities/1-6/open');
  assert.equal((await s1.post('/api/activities/1-6/chat', { message: 'اكتبي لي الموضوع' })).status, 423);
  assert.equal((await s1.post('/api/activities/1-5/chat', { message: 'اكتبي لي موضوعًا' })).status, 423, 'التوليد معطل في كل مهمات الحصة أثناء الإنتاج المستقل');
  assert.equal((await s1.get('/api/activities/1-5')).data.chatBlocked, 'independent_lesson');
  assert.equal((await s1.post('/api/activities/1-6/submit', { values: { domain: 'الرياضة' } })).status, 400);
  const ok = await s1.post('/api/activities/1-6/submit', { values: { domain: 'الرياضة', topic: 'الرياضة', goal: 'التوعية بفوائد الرياضة', audience: 'الطالبات', genre: 'المقال', reason: 'لأنها مهمة' }, meta: { pasteCount: 1 } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.meta.submittedAt);
  assert.equal((await s1.put('/api/activities/1-6/responses', { values: { topic: 'تعديل' } })).status, 409);
  assert.equal((await s1.post('/api/activities/1-6/submit', { values: {} })).status, 409);
  assert.equal((await s1.post('/api/activities/1-5/chat', { message: 'بعد التسليم' })).status, 200, 'يعود المساعد بعد التسليم');
});

test('التقويم والتحسين بمستويين: التقويم الذاتي أولًا، ثم الملاحظات، ثم النسخة المحسنة مع الاحتفاظ بالأصلية', async () => {
  const ev = (await s1.get('/api/lessons/L01')).data.lesson.activities[6];
  assert.equal(ev.evaluation.analyzeLabel, 'تحليل بطاقة موضوعي');
  assert.equal((await s1.post('/api/activities/1-7/feedback')).status, 400, 'لا ملاحظات قبل التقويم الذاتي');
  assert.equal((await s1.put('/api/activities/1-7/revised', { values: { topic: 'x' } })).status, 400);
  const ratings = { c1: { level: 'met' }, c2: { level: 'needs', note: 'واسع' }, c3: { level: 'met' }, c4: { level: 'met' } };
  let r = await s1.put('/api/activities/1-7/self-assessment', { ratings });
  assert.equal(r.data.complete, false);
  r = await s1.put('/api/activities/1-7/self-assessment', { ratings: { ...ratings, c5: { level: 'partial' } } });
  assert.equal(r.data.complete, false, 'المستوى غير المعتمد يُرفض');
  r = await s1.put('/api/activities/1-7/self-assessment', { ratings: { ...ratings, c5: { level: 'met' } } });
  assert.equal(r.data.complete, true);
  const fb = await s1.post('/api/activities/1-7/feedback');
  assert.equal(fb.status, 503);
  assert.equal(fb.data.kind, 'demo');
  assert.equal((await s1.post('/api/activities/1-7/complete')).status, 400, 'النسخة المحسنة مطلوبة');
  r = await s1.put('/api/activities/1-7/revised', { values: { domain: 'الرياضة', topic: 'أثر المشي اليومي في تركيز طالبات الصف الأول الثانوي', goal: 'التوعية', audience: 'طالبات الصف الأول الثانوي', genre: 'المقال', reason: 'متسق' } });
  assert.equal(r.status, 200);
  assert.equal((await s1.post('/api/activities/1-7/complete')).status, 200);
  // النشاط المنزلي بعد المراحل السبع
  const hw = await s1.get('/api/activities/1-H');
  assert.equal(hw.status, 200);
  assert.equal((await s1.post('/api/activities/1-H/complete')).status, 400);
  await s1.put('/api/activities/1-H/responses', { values: { hwDomain: 'البيئة', hwTopic: 'هدر الطعام', hwGoal: 'التوعية', hwAudience: 'الطالبات', choice: 'o1', choiceReason: 'أقرب إليّ' } });
  assert.equal((await s1.post('/api/activities/1-H/complete')).status, 200);
  const p = await s1.get('/api/portfolio');
  const l1 = p.data.lessons.find((l) => l.id === 'L01');
  assert.equal(l1.completed, true);
  assert.equal(l1.product.initial.topic, 'الرياضة');
  assert.ok(l1.product.revised.topic.startsWith('أثر المشي'));
  assert.ok(p.data.skills.find((s) => s.id === 1));
  assert.ok(!JSON.stringify(p.data).includes('chatCount'));
  assert.ok(String((await s1.get('/api/portfolio/export')).data).includes('ملف إنجازي الكتابي'));
});

test('عزل البيانات: الطالبة لا ترى أعمال زميلتها إلا ما اعتمدته المعلمة', async () => {
  const sh = await s1.post('/api/activities/1-5/share', {});
  assert.equal(sh.status, 200);
  let g = await s2.get('/api/activities/1-1/gallery');
  assert.equal(g.data.items.length, 0);
  const shares = await teacher.get('/api/teacher/shares');
  const share = shares.data.shares[0];
  assert.ok(JSON.stringify(share.content).includes('الفن التعبيري المناسب: اختياري=المقال'), 'الجدول يُشارك نصًّا مقروءًا');
  await teacher.patch(`/api/teacher/shares/${share.id}`, { status: 'approved', scope: 'class' });
  await teacher.post(`/api/teacher/students/${(await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[1].code).id}/unlock`, { activityId: '1-5' });
  g = await s2.get('/api/activities/1-5/gallery');
  assert.equal(g.data.items.length, 1);
  assert.ok(g.data.items[0].author.startsWith('زميلة'));
  await s2.post(`/api/shares/${share.id}/comments`, { text: 'أعجبني اختياركِ' });
  g = await s1.get('/api/activities/1-5/gallery');
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
  assert.equal(l.data.lesson.activities[0].assistant.name, 'رفيقتي في الكتابة');
  await teacher.req('DELETE', '/api/teacher/activities/1-1/assistant');
  assert.equal((await teacher.put('/api/teacher/lessons/L01/rubric', { criteria: [{ id: 'c1', text: 'معيار معدل' }] })).status, 200);
  const r = await teacher.get('/api/teacher/content');
  assert.equal(r.data.lessons[0].rubric.criteria.length, 1);
  await teacher.req('DELETE', '/api/teacher/lessons/L01/rubric');
});

test('ربط النموذج عبر الخادم: التعليمات تُبنى من نص الدليل وبيانات المهمة، والمفتاح لا يصل إلى المتصفح', async () => {
  mockMode = 'chat';
  const set = await teacher.put('/api/teacher/settings', { ai: { provider: 'openai', baseUrl: `http://localhost:${mockPort}/v1`, model: 'mock-model', apiKey: 'sk-secret-key-1234', enabled: true } });
  assert.equal(set.data.ai.keyConfigured, true);
  assert.ok(!JSON.stringify(set.data).includes('sk-secret'));
  assert.equal(set.data.ai.keyHint, '…1234');
  const r = await s2.post('/api/activities/1-1/chat', { message: 'أظن أن سارة لم تحدد موضوعها' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'ai');
  const sys = lastMockRequest.messages[0].content;
  assert.ok(sys.includes('رفيقة التحفيز'));
  assert.ok(sys.includes('التحفيز الذكي'));
  assert.ok(sys.includes('المهمة (1\u200F-\u200F1): قبل أن أكتب، ماذا أختار؟'));
  assert.ok(sys.includes('نشاط (1): ساعدي سارة على اتخاذ القرار'));
  assert.ok(sys.includes('لاحظت سارة أن بعض الطالبات يشتكين من قلة تنوع الأصناف'));
  assert.ok(sys.includes('خاطبي الطالبة بصيغة المؤنث'));
  assert.ok(sys.includes('تحديد موضوع الكتابة ومجاله تحديدًا دقيقًا.'));
  assert.ok(sys.includes('الكفاءة: الثقة بالقدرة على تعلم مهارات الكتابة وفهمها.'));
  assert.equal(lastMockRequest.messages.at(-1).content, 'أظن أن سارة لم تحدد موضوعها');
  // زر مسمى: تعليمته في السياق
  await s1.post('/api/activities/1-4/chat', { message: '«ساعديني على فحص موضوعي»', assist: 'a2' });
  assert.ok(lastMockRequest.messages[0].content.includes('ضغطت الطالبة زر «ساعديني على فحص موضوعي»'));
  assert.ok(!JSON.stringify(await s2.get('/api/me')).includes('sk-secret'));
});

test('التغذية الراجعة الذكية تُحلَّل وفق المعايير وتُحفظ، والمعلمة تراجعها', async () => {
  mockMode = 'feedback';
  const fb = await s1.post('/api/activities/1-7/feedback');
  assert.equal(fb.status, 200);
  assert.equal(fb.data.data.criteria[0].id, 'c2');
  assert.ok(lastMockRequest.messages[0].content.includes('لا تقترحي صياغة بديلة'));
  assert.ok(lastMockRequest.messages[1].content.includes('تقويمها الذاتي'));
  assert.ok(lastMockRequest.messages[1].content.includes('يحتاج إلى تحسين'));
  const a = await s1.get('/api/activities/1-7');
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

test('الحصة الثانية: البناء على منتج الحصة الأولى، والتصنيف والاختيار المتعدد، وبنك المعلومات جدولًا، والاعتماد', async () => {
  await teacher.patch('/api/teacher/lessons/L02', { enabled: true, reviewed: true });
  const pr = await s1.get('/api/products');
  const p1 = pr.data.products.find((p) => p.lessonId === 'L01');
  assert.equal(p1.version, 'revised');
  assert.ok(p1.data.topic.startsWith('أثر المشي'));
  await s1.put('/api/activities/2-1/responses', { values: { step: 'ب', info: 'آراء الطالبات' } });
  assert.equal((await s1.post('/api/activities/2-1/complete')).status, 200);
  let r = await s1.put('/api/activities/2-2/responses', { values: { related: { i1: 'k1', i2: 'k2', i3: 'k1' } } });
  assert.equal(r.data.checks.related, undefined, 'لا فحص قبل اكتمال التصنيف');
  r = await s1.put('/api/activities/2-2/responses', { values: { related: { i1: 'k1', i2: 'k2', i3: 'k1', i4: 'k2', i5: 'k2', i6: 'k1' } } });
  assert.deepEqual(r.data.checks.related.detail, [true, true, true, false, true, true]);
  r = await s1.put('/api/activities/2-2/responses', { values: { details: ['m2', 'm3'], mainIdea: 'o1' } });
  assert.equal(r.data.checks.details.correct, false);
  r = await s1.put('/api/activities/2-2/responses', { values: { details: ['m4', 'm2', 'm3', 'zz'] } });
  assert.equal(r.data.checks.details.correct, true, 'الاختيار المتعدد لا يعتمد على الترتيب، ويتجاهل غير المعتمد');
  await s1.put('/api/activities/2-2/responses', { values: { sources: { i1: 'k1', i2: 'k2', i3: 'k3', i4: 'k4' }, related: { i1: 'k1', i2: 'k2', i3: 'k1', i4: 'k1', i5: 'k2', i6: 'k1' } } });
  assert.equal((await s1.post('/api/activities/2-2/complete')).status, 200);
  await s1.put('/api/activities/2-3/responses', { values: { relation: '..', difference: '..' } });
  assert.equal((await s1.post('/api/activities/2-3/complete')).status, 200);
  const row = (a, b, c) => ({ c1: a, c2: b, c3: c });
  await s1.put('/api/activities/2-4/responses', { values: { ideas: ['التركيز', 'النشاط', 'المزاج'], plan: { r1: row('التركيز', 'مدة الانتباه', 'ملاحظة'), r2: row('النشاط', 'الحيوية', 'استبانة') } } });
  assert.equal((await s1.post('/api/activities/2-4/complete')).status, 200);
  await s1.put('/api/activities/2-5/responses', { values: { picked: ['m1', 'm2', 'm4'], usable: ['m1', 'm2', 'm3'], whyVerify: 'الدقة', peerIdea: 'التركيز', peerInfo: 'دراسة', peerVerify: 'o2', peerGave: 'مثال', organized: { r1: row('أ', 'ب', 'ج'), r2: row('أ', 'ب', 'ج'), r3: row('أ', 'ب', 'ج') } } });
  assert.equal((await s1.post('/api/activities/2-5/complete')).status, 200);
  const bank = { r1: { c1: 'التركيز', c2: 'انتباه أطول', c3: 'هدوء', c4: 'ملاحظة' }, r2: { c1: 'النشاط', c2: 'حيوية', c3: 'نوم', c4: 'تحتاج تحقق' } };
  assert.equal((await s1.post('/api/activities/2-6/submit', { values: { bank, importance: 'مهمة' } })).status, 400, 'الفكرة الثالثة ناقصة');
  bank.r3 = { c1: 'المزاج', c2: 'هدوء', c3: 'رضا', c4: 'كتاب' };
  assert.equal((await s1.post('/api/activities/2-6/submit', { values: { bank, importance: 'مهمة' } })).status, 200);
  const p2 = (await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L02');
  assert.equal(p2.version, 'initial');
  assert.equal(JSON.parse(p2.data.bank).r1.c2, 'انتباه أطول');
  const csv = String((await teacher.get('/api/teacher/export.csv')).data);
  assert.ok(csv.includes('المعلومة أو التفصيل الأول: انتباه أطول'), 'الجدول يُصدَّر نصًّا مقروءًا');
  const st = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[0].code);
  assert.equal((await teacher.post(`/api/teacher/students/${st.id}/approve`, { lessonId: 'L02' })).status, 200);
  assert.ok((await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L02').approvedAt);
  const html = String((await s1.get('/api/portfolio/export')).data);
  assert.ok(html.includes('انتباه أطول') && !html.includes('{&quot;'));
});

test('أداة المخطط: تُحفظ نصًّا منظمًا وتُتحقق من اكتمالها', async () => {
  for (const id of ['L03', 'L04', 'L05']) await teacher.patch(`/api/teacher/lessons/${id}`, { enabled: true, reviewed: true });
  const st = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[0].code);
  await teacher.post(`/api/teacher/students/${st.id}/unlock`, { activityId: '5-6' });
  const plan = { mode: 'tree', topic: 'أثر المشي', ideas: [{ element: 'المقدمة', idea: 'التركيز', details: ['انتباه'], method: '' }, { element: 'العرض', idea: 'النشاط', details: [] }] };
  assert.equal((await s1.post('/api/activities/5-6/submit', { values: { plan: JSON.stringify(plan), why: 'مناسب' } })).status, 400, 'فكرتان فقط والثانية بلا تفصيل');
  plan.ideas[1].details = ['حيوية']; plan.ideas.push({ element: 'الخاتمة', idea: 'المزاج', details: ['هدوء'] });
  plan.mode = 'nonsense';
  assert.equal((await s1.post('/api/activities/5-6/submit', { values: { plan: JSON.stringify(plan), why: 'مناسب' } })).status, 400, 'شكل التخطيط مطلوب');
  plan.mode = 'fishbone';
  assert.equal((await s1.post('/api/activities/5-6/submit', { values: { plan: JSON.stringify(plan), why: 'مناسب' } })).status, 200);
  const p5 = (await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L05');
  assert.equal(JSON.parse(p5.data.plan).mode, 'fishbone');
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
  const ind = await teacher.get('/api/teacher/ratings/1-6');
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
  assert.equal(det.data.lessons[0].activities[0].rating.values[c1.id], 4);
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
