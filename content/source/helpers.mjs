// أدوات مختصرة لكتابة مواصفات التفاعل في ملفات spec-L0N.mjs
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

/** اختيار من متعدد بالبدائل المرقمة (أ، ب، ج، د) كما وردت في الدليل، مع تغذية راجعة لكل بديل */
export function mcq(id, label, options, answerIndex, feedback, extra = {}) {
  const opts = options.map((t, i) => ({ id: LETTERS[i], text: `(${LETTERS[i]}) ${t}` }));
  const optionFeedback = {};
  options.forEach((_, i) => { if (feedback[i]) optionFeedback[LETTERS[i]] = feedback[i]; });
  return { id, type: 'choice', label, required: true, options: opts, answerKey: LETTERS[answerIndex], optionFeedback, checkLabel: 'تحقق من إجابتي', ...extra };
}
/** اختيار من بديلين أو أكثر دون ترقيم */
export function pick(id, label, options, answerIndex, feedback = [], extra = {}) {
  const opts = options.map((t, i) => ({ id: `o${i + 1}`, text: t }));
  const optionFeedback = {};
  options.forEach((_, i) => { if (feedback[i]) optionFeedback[`o${i + 1}`] = feedback[i]; });
  const f = { id, type: 'choice', label, required: true, options: opts, optionFeedback, ...extra };
  if (answerIndex != null) { f.answerKey = `o${answerIndex + 1}`; f.checkLabel ??= 'تحقق من إجابتي'; }
  return f;
}
export const text = (id, label, extra = {}) => ({ id, type: 'text', label, required: true, ...extra });
export const area = (id, label, extra = {}) => ({ id, type: 'textarea', label, required: true, ...extra });
export const opt = (id, label, extra = {}) => ({ id, type: 'textarea', label, required: false, ...extra });
export const select = (id, label, options, extra = {}) => ({ id, type: 'select', label, required: true, options, ...extra });

/** مطابقة بقوائم منسدلة («اختاري من القائمة») */
export function match(id, label, items, categories, answers, extra = {}) {
  const its = items.map((t, i) => ({ id: `i${i + 1}`, text: t }));
  const cats = categories.map((c, i) => ({ id: `k${i + 1}`, name: c }));
  const key = {};
  answers.forEach((a, i) => { key[`i${i + 1}`] = `k${categories.indexOf(a) + 1}`; if (categories.indexOf(a) < 0) throw new Error(`${id}: ${a}`); });
  return { id, type: 'classify', display: 'select', label, required: true, items: its, categories: cats, answerKey: key, ...extra };
}
/** تصنيف في مجموعات (أزرار) */
export function classify(id, label, items, categories, answers, extra = {}) {
  return { ...match(id, label, items, categories, answers, extra), display: 'buttons' };
}
/** ترتيب: العناصر بالترتيب المعروض، والإجابة بترتيب الفهارس الصحيح */
export function order(id, label, items, correct, extra = {}) {
  const its = items.map((t, i) => ({ id: `s${i + 1}`, text: t }));
  return { id, type: 'ordering', label, required: true, items: its, answerKey: correct.map((i) => `s${i + 1}`), checkLabel: 'تحقق من ترتيبي', ...extra };
}
/** جدول حقول («أكتب هنا»)؛ rows: [label] أو [label, options] */
export function table(id, label, rowHeader, rows, columns, extra = {}) {
  return {
    id, type: 'table', label, required: true, rowHeader,
    rows: rows.map((r, i) => (Array.isArray(r) ? { id: `r${i + 1}`, label: r[0], options: r[1] } : { id: `r${i + 1}`, label: r })),
    columns: columns.map((c, i) => (Array.isArray(c) ? { id: `c${i + 1}`, label: c[0], options: c[1] } : { id: `c${i + 1}`, label: c })),
    ...extra,
  };
}
export const multi = (id, label, options, answers, extra = {}) => ({
  id, type: 'multi', label, required: true, options: options.map((t, i) => ({ id: `m${i + 1}`, text: t })),
  ...(answers ? { answerKey: answers.map((i) => `m${i + 1}`), checkLabel: 'تحقق من إجابتي' } : {}), ...extra,
});

// عناصر محتوى إضافية تعرضها المنصة
export const note = (title, t) => ({ type: 'material', material: { type: 'note', title, text: t, proposed: true } });
export const card = (title, tone, rows, notes) => ({ type: 'material', material: { type: 'modelCard', title, tone, rows: rows.map(([label, value]) => ({ label, value })), ...(notes ? { notes } : {}), proposed: true } });
export const examples = (title, items) => ({ type: 'material', material: { type: 'examples', title, items: items.map(([label, t]) => ({ label, text: t })), proposed: true } });
export const think = (title, steps, intro) => ({ type: 'material', material: { type: 'thinkAloud', title, ...(intro ? { intro } : {}), steps: steps.map(([t, x]) => ({ title: t, text: x })), proposed: true } });
/** تغذية راجعة نموذجية تُكشف بعد أن تكتب الطالبة إجابتها في الحقل المحدد */
export const reveal = (title, afterField, items) => ({ type: 'material', material: { type: 'criteria', title, revealAfter: afterField, items: items.map(([label, t]) => ({ label, text: t })), proposed: true } });
export const diagram = (mode, topic, ideas, title) => ({ type: 'diagram', mode, title, value: { mode, topic, ideas: ideas.map(([element, idea, details, method]) => ({ element, idea, details, method: method ?? '' })) } });

export const assist = (label, message) => ({ label, ...(message ? { message } : {}) });
export const assistFree = (label, message) => ({ label, free: true, ...(message ? { message } : {}) });

/** حقول التبادل مع الزميلة */
export const peerFields = (p) => [
  opt(`${p}Got`, 'ملاحظة زميلتي على عملي'),
  area(`${p}Gave`, 'ملاحظتي القصيرة على عمل زميلتي'),
  pick(`${p}Need`, 'هل أحتاج إلى تعديل عملي في ضوء المناقشة؟', ['نعم، سأعدّل عملي', 'لا، عملي مناسب كما هو']),
  opt(`${p}Change`, 'التعديل الذي سأجريه (إن وجد)'),
];
