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

test('نسخة الطالبة لا تتضمن مفاتيح الإجابة ولا التلميحات ولا تعليمات المساعد الداخلية', async () => {
  const r = await s1.get('/api/lessons/L01');
  assert.equal(r.status, 200);
  const raw = JSON.stringify(r.data);
  assert.ok(!raw.includes('answerKey'));
  assert.ok(!raw.includes('constraints'));
  assert.ok(!raw.includes('teacherProcedures'));
  assert.ok(!raw.includes('في مجال الرياضة مثلًا')); // نص تلميح
  assert.ok(!raw.includes('يمكن الإحاطة به في موضوع واحد')); // معيار لا يُكشف قبل المحاولة
  assert.equal(Object.keys(r.data.statuses).length, 8);
  assert.equal(r.data.statuses['1-1'], 'available');
  assert.equal(r.data.statuses['1-2'], 'locked');
});

test('الحصة غير المتاحة مغلقة أمام الطالبة', async () => {
  assert.equal((await s1.get('/api/lessons/L02')).status, 403);
});

test('ضبط الانتقال: لا يُفتح النشاط التالي قبل استيفاء متطلبات الحالي', async () => {
  assert.equal((await s1.get('/api/activities/1-2')).status, 403);
  const c = await s1.post('/api/activities/1-1/complete');
  assert.equal(c.status, 400);
  assert.ok(c.data.missing.length === 3);
  await s1.put('/api/activities/1-1/responses', { values: { problem: 'لم تحدد موضوعًا', suggestion: 'أن تسأل نفسها: عمّ أكتب ولمن؟', personalGoal: 'أن أختار موضوعًا دقيقًا' } });
  assert.equal((await s1.post('/api/activities/1-1/complete')).status, 200);
  assert.equal((await s1.get('/api/activities/1-2')).status, 200);
});

test('الوضع التجريبي يعرض الأسئلة بالتتابع ويُوسم بأنه غير متصل بالنموذج', async () => {
  const r1 = await s2.post('/api/activities/1-1/chat', { message: 'نعم مستعدة' });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.mode, 'demo');
  assert.ok(r1.data.reply.includes('ما المشكلة التي واجهت سارة؟'));
  const r2 = await s2.post('/api/activities/1-1/chat', { message: 'لم تحدد موضوعها' });
  assert.ok(r2.data.reply.includes('أشياء مهمة في حياتنا'));
});

test('الكشف عن المعايير بعد استنتاج الطالبة، والفحص الموضوعي للترتيب', async () => {
  let r = await s1.put('/api/activities/1-2/responses', { values: { criteria: ['الوضوح'] } });
  assert.equal(r.data.reveal.length, 0, 'معيار واحد لا يكفي (الحد الأدنى اثنان)');
  r = await s1.put('/api/activities/1-2/responses', { values: { criteria: ['الوضوح', 'التحديد'] } });
  assert.equal(r.data.reveal.length, 1);
  await s1.put('/api/activities/1-2/responses', { values: {
    classification: { a: 'domain', b: 'domain', c: 'topic', d: 'domain', e: 'topic' }, classificationReason: 'لأن...', environmentTopic: 'أثر فرز النفايات في نظافة المدرسة',
    healthTopic: 'أثر النوم المبكر في تركيز الطالبات', healthReason: 'واضح ومحدد',
  } });
  assert.equal((await s1.post('/api/activities/1-2/complete')).status, 200);
  await s1.put('/api/activities/1-3/responses', { values: {
    commonTopic: 'البيئة المدرسية', rule: 'الهدف والجمهور يحددان طريقة الكتابة', newTopic: 'الحملة التطوعية', newGoal: 'الإقناع', newAudience: 'الزميلات',
    comparison: { s1: { goal: 'اقتراح', audience: 'الإدارة', style: 'رسمي' }, s2: { goal: 'توعية', audience: 'الطالبات', style: 'ودي' }, s3: { goal: 'تعريف', audience: 'الجديدات', style: 'ترحيبي' } },
  } });
  assert.equal((await s1.post('/api/activities/1-3/complete')).status, 200);
  r = await s1.put('/api/activities/1-4/responses', { values: { procedureOrder: ['s1', 's2', 's3', 's5', 's4', 's6', 's7'], whyNotFirst: 'واسع', strongVsWeak: 'الجمهور والهدف' } });
  assert.equal(r.data.checks.procedureOrder.correct, false);
  assert.deepEqual(r.data.checks.procedureOrder.detail, [true, true, true, false, false, true, true]);
  r = await s1.put('/api/activities/1-4/responses', { values: { procedureOrder: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] } });
  assert.equal(r.data.checks.procedureOrder.correct, true);
  assert.equal((await s1.post('/api/activities/1-4/complete')).status, 200);
});

test('التلميحات المتدرجة وتخفيض المساندة في التحدي الثالث', async () => {
  await s1.put('/api/activities/1-5/responses', { values: { domain: 'الصحة', alternatives: ['الصحة', 'النوم'], topic: 'أثر النوم', reason: 'يهمني', goal: 'التوعية', audience: 'الطالبات', verification: 'بالمعايير' } });
  assert.equal((await s1.post('/api/activities/1-5/complete')).status, 200);
  let h = await s1.post('/api/activities/1-6/hint', { section: 'task1' });
  assert.equal(h.data.hints.length, 1);
  h = await s1.post('/api/activities/1-6/hint', { section: 'task1' });
  h = await s1.post('/api/activities/1-6/hint', { section: 'task1' });
  assert.equal(h.data.hints.length, 3);
  assert.equal(h.data.done, true);
  assert.equal(h.data.hints[2].kind, 'مثال من مجال مختلف');
  assert.equal((await s1.post('/api/activities/1-6/hint', { section: 'task3' })).status, 400, 'لا تلميح قبل المحاولة');
  const r = await s1.put('/api/activities/1-6/responses', { values: { t2Choice: 'o2' } });
  assert.equal(r.data.checks.t2Choice.correct, false);
  await s1.put('/api/activities/1-6/responses', { values: { t3Topic: 'أثر المشي' } });
  assert.equal((await s1.post('/api/activities/1-6/hint', { section: 'task3' })).status, 200);
  await s1.put('/api/activities/1-6/responses', { values: {
    t1Topic: 'أثر العمل التطوعي في تحمل المسؤولية', t1Goal: 'التوعية', t1Audience: 'الطالبات', t2Choice: 'o1', t2Reason: 'يتصل بالموضوع', t2Audience: 'الطالبات',
    t3Domain: 'الصحة', t3Goal: 'التوعية', t3Audience: 'الطالبات', improvement: 'تحديد الجمهور',
  } });
  assert.equal((await s1.post('/api/activities/1-6/complete')).status, 200);
});

test('الإنتاج المستقل: منع برمجي للتوليد، وحفظ النسخة الأولية مع وقت التسليم، وعدم تعديلها', async () => {
  assert.equal((await s1.post('/api/activities/1-6/chat', { message: 'قبل البدء' })).status, 200, 'المساعد يعمل قبل فتح الإنتاج المستقل');
  await s1.post('/api/activities/1-7/open');
  const blocked = await s1.post('/api/activities/1-7/chat', { message: 'اكتبي لي الموضوع' });
  assert.equal(blocked.status, 423);
  const blockedOther = await s1.post('/api/activities/1-6/chat', { message: 'اكتبي لي موضوعًا عن الصحة' });
  assert.equal(blockedOther.status, 423, 'التوليد معطل في كل أنشطة الحصة أثناء الإنتاج المستقل');
  const a = await s1.get('/api/activities/1-6');
  assert.equal(a.data.chatBlocked, 'independent_lesson');
  const miss = await s1.post('/api/activities/1-7/submit', { values: { domain: 'الرياضة' } });
  assert.equal(miss.status, 400);
  const ok = await s1.post('/api/activities/1-7/submit', { values: { domain: 'الرياضة', topic: 'الرياضة', goal: 'التوعية بفوائد الرياضة', audience: 'الطالبات', justification: 'لأنها مهمة' }, meta: { pasteCount: 1 } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.meta.submittedAt);
  assert.equal((await s1.put('/api/activities/1-7/responses', { values: { topic: 'تعديل' } })).status, 409);
  assert.equal((await s1.post('/api/activities/1-7/submit', { values: {} })).status, 409);
  assert.equal((await s1.post('/api/activities/1-6/chat', { message: 'بعد التسليم' })).status, 200, 'يعود المساعد بعد التسليم');
});

test('التقويم والتحسين: التقويم الذاتي أولًا، ثم الملاحظات، ثم النسخة المحسنة والمقارنة', async () => {
  assert.equal((await s1.post('/api/activities/1-8/feedback')).status, 400, 'لا ملاحظات قبل التقويم الذاتي');
  assert.equal((await s1.put('/api/activities/1-8/revised', { values: { topic: 'x' } })).status, 400, 'لا تعديل قبل التقويم الذاتي');
  const ratings = { c1: { level: 'met' }, c2: { level: 'partial', note: 'واسع قليلًا' }, c3: { level: 'met' }, c4: { level: 'met' } };
  let r = await s1.put('/api/activities/1-8/self-assessment', { ratings });
  assert.equal(r.data.complete, false);
  r = await s1.put('/api/activities/1-8/self-assessment', { ratings: { ...ratings, c5: { level: 'partial' } } });
  assert.equal(r.data.complete, true);
  const fb = await s1.post('/api/activities/1-8/feedback');
  assert.equal(fb.status, 503, 'في الوضع التجريبي لا تُعرض ملاحظات مختلقة');
  assert.equal(fb.data.kind, 'demo');
  r = await s1.put('/api/activities/1-8/revised', { values: { domain: 'الرياضة', topic: 'أثر المشي اليومي في تركيز طالبات الصف الأول الثانوي', goal: 'التوعية', audience: 'طالبات الصف الأول الثانوي', justification: 'متسق' } });
  assert.equal(r.status, 200);
  let c = await s1.post('/api/activities/1-8/complete');
  assert.equal(c.status, 400);
  assert.deepEqual(c.data.missing.length, 1);
  await s1.put('/api/activities/1-8/responses', { values: { reflection: 'ضيّقت موضوعي' } });
  assert.equal((await s1.post('/api/activities/1-8/complete')).status, 200);
  const p = await s1.get('/api/portfolio');
  const l1 = p.data.lessons.find((l) => l.id === 'L01');
  assert.equal(l1.completed, true);
  assert.equal(l1.product.initial.topic, 'الرياضة');
  assert.ok(l1.product.revised.topic.startsWith('أثر المشي'));
  assert.equal(l1.goals[0], 'أن أختار موضوعًا دقيقًا');
  assert.equal(l1.planningCards.length, 1);
  assert.ok(p.data.skills.find((s) => s.id === 1));
  assert.ok(!JSON.stringify(p.data).includes('chatCount'), 'لا يُعرض عدد مرات استخدام المساعد');
  const html = await s1.get('/api/portfolio/export');
  assert.ok(String(html.data).includes('ملف إنجازي الكتابي'));
});

test('عزل البيانات: الطالبة لا ترى أعمال زميلتها إلا ما اعتمدته المعلمة', async () => {
  const sh = await s1.post('/api/activities/1-1/share', {});
  assert.equal(sh.status, 200);
  let g = await s2.get('/api/activities/1-1/gallery');
  assert.equal(g.data.items.length, 0, 'لا يُنشر شيء قبل موافقة المعلمة');
  const shares = await teacher.get('/api/teacher/shares');
  const id = shares.data.shares[0].id;
  await teacher.patch(`/api/teacher/shares/${id}`, { status: 'approved', scope: 'class' });
  g = await s2.get('/api/activities/1-1/gallery');
  assert.equal(g.data.items.length, 1);
  assert.ok(g.data.items[0].author.startsWith('زميلة'));
  await s2.post(`/api/shares/${id}/comments`, { text: 'أعجبني اقتراحكِ' });
  g = await s1.get('/api/activities/1-1/gallery');
  assert.equal(g.data.items[0].comments.length, 0, 'التعليق يظهر بعد مراجعة المعلمة');
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

test('ربط النموذج عبر الخادم: التعليمات تُبنى من بيانات النشاط، والمفتاح لا يصل إلى المتصفح', async () => {
  mockMode = 'chat';
  const set = await teacher.put('/api/teacher/settings', { ai: { provider: 'openai', baseUrl: `http://localhost:${mockPort}/v1`, model: 'mock-model', apiKey: 'sk-secret-key-1234', enabled: true } });
  assert.equal(set.data.ai.keyConfigured, true);
  assert.ok(!JSON.stringify(set.data).includes('sk-secret'));
  assert.equal(set.data.ai.keyHint, '…1234');
  const r = await s2.post('/api/activities/1-1/chat', { message: 'أظن أن سارة لم تحدد موضوعها' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'ai');
  const sys = lastMockRequest.messages[0].content;
  assert.ok(sys.includes('صديقتي المحفزة للكتابة'));
  assert.ok(sys.includes('التحفيز الذكي'));
  assert.ok(sys.includes('خاطبي الطالبة بصيغة المؤنث'));
  assert.ok(sys.includes('تحديد موضوع الكتابة ومجاله تحديدًا دقيقًا.'));
  assert.ok(sys.includes('الكفاءة: الثقة بالقدرة على تعلم مهارات الكتابة وفهمها.'));
  assert.equal(lastMockRequest.messages.at(-1).content, 'أظن أن سارة لم تحدد موضوعها');
  assert.ok(!JSON.stringify(await s2.get('/api/me')).includes('sk-secret'));
});

test('التغذية الراجعة الذكية تُحلَّل وفق المعايير وتُحفظ، والمعلمة تراجعها', async () => {
  mockMode = 'feedback';
  const fb = await s1.post('/api/activities/1-8/feedback');
  assert.equal(fb.status, 200);
  assert.equal(fb.data.data.criteria[0].id, 'c2');
  assert.ok(lastMockRequest.messages[0].content.includes('لا تقترحي صياغة بديلة'));
  assert.ok(lastMockRequest.messages[1].content.includes('تقويمها الذاتي'));
  const a = await s1.get('/api/activities/1-8');
  assert.equal(a.data.evaluation.feedback.length, 1);
});

test('ربط Gemini: عنوان الخدمة ثابت، والمفتاح عبر الخادم، والنموذج الافتراضي مناسب', async () => {
  mockMode = 'chat';
  const set = await teacher.put('/api/teacher/settings', { ai: { provider: 'gemini', model: 'mock-model', apiKey: 'AIza-gemini-key-9876', enabled: true } });
  assert.equal(set.data.ai.provider, 'gemini');
  assert.equal(set.data.ai.model, 'gemini-3.8-flash'); // اسم نموذج لا يخص Gemini يُستبدل بالافتراضي
  assert.ok(set.data.ai.baseUrl.startsWith('https://generativelanguage.googleapis.com/'));
  assert.ok(!JSON.stringify(set.data).includes('AIza-gemini'));
  const r = await s2.post('/api/activities/1-1/chat', { message: 'سؤال إلى Gemini' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'ai');
  assert.equal(lastMockMeta.url, '/gemini/v1beta/openai/chat/completions');
  assert.equal(lastMockMeta.auth, 'Bearer AIza-gemini-key-9876');
  assert.equal(lastMockRequest.model, 'gemini-3.8-flash');
  assert.equal(lastMockRequest.reasoning_effort, 'low');
  assert.ok(lastMockRequest.messages[0].content.includes('صديقتي المحفزة للكتابة'));
  // تبديل المزود يحذف مفتاح المزود السابق
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

test('الحصة الثانية: البناء على منتج الحصة الأولى، والمخطط، والفحص بعد التصنيف، والاعتماد', async () => {
  await teacher.patch('/api/teacher/lessons/L02', { enabled: true, reviewed: true });
  const pr = await s1.get('/api/products');
  const p1 = pr.data.products.find((p) => p.lessonId === 'L01');
  assert.equal(p1.version, 'revised');
  assert.ok(p1.data.topic.startsWith('أثر المشي'));
  await s1.put('/api/activities/2-1/responses', { values: { problem: 'لا أفكار لديها', help: 'أسئلة مساعدة', personalGoal: 'أن أولد أفكارًا' } });
  assert.equal((await s1.post('/api/activities/2-1/complete')).status, 200);
  let r = await s1.put('/api/activities/2-2/responses', { values: { related: { i1: 'k1', i2: 'k1', i3: 'k1', i4: 'k1' } } });
  assert.equal(r.data.checks.related, undefined, 'لا فحص قبل اكتمال التصنيف');
  r = await s1.put('/api/activities/2-2/responses', { values: { related: { i1: 'k1', i2: 'k1', i3: 'k1', i4: 'k1', i5: 'k2', i6: 'k1' } } });
  assert.deepEqual(r.data.checks.related.detail, [true, true, true, false, true, true]);
  await s1.put('/api/activities/2-2/responses', { values: { reason: 'لأن...', mainVsDetail: '...', newIdea: 'فكرة', criteria: ['الارتباط', 'الوضوح'] } });
  assert.equal((await s1.post('/api/activities/2-2/complete')).status, 200);
  await s1.put('/api/activities/2-3/responses', { values: { questionsUsed: 'ماذا ولماذا', whyExcluded: 'بعيدة', steps: ['s1', 's2', 's3', 's4', 's5'] } });
  assert.equal((await s1.post('/api/activities/2-3/complete')).status, 200);
  await s1.put('/api/activities/2-4/responses', { values: { myTopic: 'أثر المشي', aspects: ['أ', 'ب'], questions: ['1', '2', '3'], sources: 'تجربتي', initialIdeas: ['1', '2', '3'] } });
  assert.equal((await s1.post('/api/activities/2-4/complete')).status, 200);
  // المخطط: ثلاث أفكار وتحت كل منها تفصيل
  await s1.put('/api/activities/2-5/responses', { values: { practiceIdeas: '1. وضع النفايات في الحاويات\n   - حاوية في كل فصل\n2. تنظيف المقاعد', justify: '..', difference: '..' } });
  let c = await s1.post('/api/activities/2-5/complete');
  assert.equal(c.status, 400, 'المخطط ناقص (فكرتان، والثانية بلا تفصيل)');
  await s1.put('/api/activities/2-5/responses', { values: { practiceIdeas: '1. وضع النفايات في الحاويات\n   - حاوية في كل فصل\n2. تنظيف المقاعد\n   - بعد كل نشاط\n3. التشجير\n   - زراعة شتلات' } });
  assert.equal((await s1.post('/api/activities/2-5/complete')).status, 200);
  const miss = await s1.post('/api/activities/2-6/submit', { values: { topic: 'أثر المشي', ideas: '1. التركيز' } });
  assert.equal(miss.status, 400);
  const ok = await s1.post('/api/activities/2-6/submit', { values: { topic: 'أثر المشي', ideas: '1. التركيز\n   - انتباه أطول\n2. النشاط\n   - حيوية الصباح\n3. المزاج\n   - هدوء' } });
  assert.equal(ok.status, 200);
  const p2 = (await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L02');
  assert.equal(p2.version, 'initial');
  assert.ok(p2.data.ideas.includes('انتباه أطول'));
  const st = (await teacher.get('/api/teacher/overview')).data.students.find((s) => s.code === codes[0].code);
  assert.equal((await teacher.post(`/api/teacher/students/${st.id}/approve`, { lessonId: 'L02' })).status, 200);
  const p2b = (await s1.get('/api/products')).data.products.find((p) => p.lessonId === 'L02');
  assert.ok(p2b.approvedAt);
  const port = await s1.get('/api/portfolio');
  assert.ok(port.data.journey.find((j) => j.lessonId === 'L02').data);
});
