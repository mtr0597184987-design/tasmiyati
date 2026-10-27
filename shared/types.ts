// أنواع البيانات المشتركة بين الخادم والواجهة.
// تمثل هذه الأنواع كيانات: Lesson, StrategyStage, Activity, ActivityContent, Rubric, AIConfiguration ...

export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface StrategyStage {
  id: StageId;
  key: string;
  name: string;
  icon: string;
  studentHint: string;
  assistantFunction: string;
}

export interface Skill {
  id: number;
  domain: 'pre' | 'during' | 'post';
  text: string; // الصياغة الرسمية المعتمدة
  studentLabel: string; // صياغة مبسطة للطالبة
}

export interface MotivationIndicator { id: string; text: string }
export interface MotivationDimension { id: string; name: string; indicators: MotivationIndicator[] }

// ---- ActivityContent: المواد التعليمية ----
export type Material =
  | { type: 'scenario' | 'task' | 'note'; title: string; text: string; proposed?: boolean }
  | { type: 'examples'; title: string; items: { label: string; text: string }[]; proposed?: boolean }
  | { type: 'criteria'; title: string; items?: { label: string; text: string }[]; revealAfter?: string; fromRubric?: boolean; locked?: boolean; proposed?: boolean }
  | { type: 'thinkAloud'; title: string; intro?: string; steps: { title: string; text: string; list?: string[] }[]; proposed?: boolean }
  | { type: 'modelCard'; title: string; tone: 'strong' | 'weak'; rows: { label: string; value: string }[]; notes?: string[]; proposed?: boolean };

// ---- ورقة العمل ----
export type FieldType = 'text' | 'textarea' | 'choice' | 'select' | 'multi' | 'chips' | 'classify' | 'table' | 'ordering' | 'list' | 'outline' | 'planner';

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  options?: (string | { id: string; text: string })[];
  allowOther?: boolean;
  items?: { id: string; text: string }[];
  categories?: { id: string; name: string }[];
  rows?: { id: string; label: string; options?: string[] }[]; // options: الخلية قائمة اختيار
  columns?: { id: string; label: string; options?: string[] }[];
  rowHeader?: string; // عنوان عمود الصفوف في الجدول
  optionalRows?: string[]; // صفوف لا يلزم ملؤها (مثل «عنصر إضافي عند الحاجة»)
  display?: 'buttons' | 'select'; // التصنيف: أزرار أو قائمة منسدلة (المطابقة)
  max?: number; // الاختيار المتعدد: أقصى عدد
  checkable?: boolean; // للطالبة: للحقل مفتاح فحص على الخادم
  checkLabel?: string; // اسم زر الفحص الموضوعي كما في الدليل
  optionFeedback?: Record<string, string>; // تغذية راجعة لكل بديل في الاختيار من متعدد
  plannerModes?: PlannerMode[]; // أشكال التخطيط المتاحة في أداة المخطط
  answerKey?: unknown; // لا يُرسل إلى الطالبة
  feedback?: { ok: string; no: string }; // رسالة الفحص الموضوعي بعد المحاولة
  portfolio?: 'goal' | 'reflection';
  minDetails?: number; // المخطط: أقل عدد من التفصيلات لكل فكرة
  minWords?: number;
  minParagraphs?: number;
  longText?: boolean;
  maxLength?: number;
  defaultValue?: string; // نص تبدأ منه الطالبة (مثل نص تدريبي تعدّله)
  mustChange?: boolean; // لا يُقبل الحقل إن بقي كما هو
  prefill?: { lesson: string; field: string }[]; // يُسترجع من منتجات الطالبة السابقة بطلبها
  given?: Record<string, Record<string, string>>; // الجدول: خلايا معطاة في الكتاب (للقراءة فقط)
}

export interface Hint { level: number; kind: string; text: string }

export type PlannerMode = 'table' | 'tree' | 'fishbone';
export interface PlannerIdea { element: string; idea: string; details: string[]; method: string }
export interface PlannerValue { mode: PlannerMode | ''; topic: string; ideas: PlannerIdea[] }

/** عناصر محتوى القسم بترتيبها في الدليل: نص، أو جدول عرض، أو مادة، أو مخطط نموذجي، أو موضع الحقول */
export type SectionItem =
  | { type: 'p'; text: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'material'; material: Material }
  | { type: 'diagram'; title?: string; mode: PlannerMode; value: PlannerValue }
  | { type: 'box'; title?: string; items: string[]; ordered?: boolean; tone?: 'read' | 'plain' } // إطار «اقرأ» أو قائمة نقاط من الكتاب
  | { type: 'passage'; title?: string; text: string; source?: string } // نص قرائي منقول من الكتاب
  | { type: 'image'; src: string; alt: string; caption?: string }
  | { type: 'fields' };

export interface WorksheetSection {
  id?: string;
  title: string;
  number?: number; // رقم النشاط داخل المهمة
  intro?: string;
  content?: SectionItem[];
  fieldsHeading?: string; // عنوان مجموعة الحقول (مثل رأس عمود «اختياري المستقل» في الدليل)
  assist?: { label: string; message: string }; // زر يستدعي المساعد (مثل «فحص اختياراتي»)
  hints?: Hint[];
  hintPolicy?: 'always' | 'after_attempt';
  proposed?: boolean;
  fields: Field[];
}

export interface AssistantQuestion {
  id: string;
  text: string;
  hints?: string[];
  success?: string;
  retry?: string;
}

export type AssistantMode = 'dialogue' | 'modeling' | 'disabled' | 'evaluation';

export interface AssistantConfig {
  name: string;
  mode: AssistantMode;
  supportLevel: 'high' | 'medium' | 'low' | 'fading' | 'none';
  opening: string;
  showMaterialsAfterOpening?: boolean;
  questions: AssistantQuestion[];
  closing?: string;
  refusal?: string;
  lockMessage?: string;
  constraints?: string[];
  feedbackCriteria?: string[];
  quickPrompts?: { label: string; message: string; section?: string }[];
  extraInstructions?: string; // تضيفها المعلمة من لوحة التحكم
}

export interface Activity {
  id: string;
  stage: StageId;
  title: string;
  minutes?: number;
  homework?: boolean; // النشاط المنزلي: بعد الخطوة السابعة وخارج ترتيبها
  book?: { pages: string; part: string; test?: boolean; note?: string }; // من كتاب الطالبة: متاح طوال الحصة وخارج ترتيب الخطوات
  completeLabel?: string; // اسم زر الإكمال (مثل «اعتماد موضوعي»)
  submitLabel?: string; // اسم زر التسليم في الإنتاج المستقل (مثل «تسليم المهمة»)
  goal?: string;
  skills: number[];
  motivation: string[];
  expectedOutput?: string;
  teacherProcedures?: string[];
  studentProcedures: string[];
  materials: Material[];
  assistant: AssistantConfig;
  worksheet: { sections: WorksheetSection[] };
  peer?: { enabled: boolean; prompt: string; fields: string[] };
  independent?: boolean;
  evaluation?: { sourceActivity: string; analyzeLabel?: string; selfIntro?: string };
  portfolio?: 'planningCard';
  showProducts?: string[]; // منتجات حصص سابقة تُعرض للطالبة ويطّلع عليها المساعد
  requirements: { fields: string[]; submitted?: boolean; selfAssessment?: boolean; revised?: boolean; revealAll?: boolean };
}

export interface RubricCriterion { id: string; text: string; skills: number[]; fields: string[] }
export interface Rubric { header?: string; levels: { id: string; label: string }[]; criteria: RubricCriterion[] }

export interface Lesson {
  id: string;
  kind?: 'book'; // قسم من كتاب الطالبة خارج الحصص التسع (مدخل الوحدة، أنشطة للدرس، ختام الوحدة)
  place?: 'intro' | 'lesson' | 'outro';
  number: number;
  status: 'authored' | 'draft';
  title: string;
  unit: string;
  courseLesson: { number: number; title: string };
  audience: string;
  durationMinutes: number;
  skills: number[];
  reinforcedSkills: number[];
  integratedSkills?: number[];
  skillsNote?: string;
  finalOutput: string;
  overview?: string; // أولًا: فكرة عامة عن الدرس
  objectivesIntro?: string;
  objectives?: string[]; // ثانيًا: الأهداف التعليمية
  skillsText?: string; // مهارات الكتابة كما وردت في الدليل
  productLabel?: string; // «المنتج الكتابي» أو «التطبيق الكتابي»
  homeworkTitle?: string;
  homeworkFollowup?: string[]; // متابعة المعلمة وتقويم النشاط المنزلي
  bookPages?: string; // صفحات كتاب الطالبة المرتبطة بالحصة
  productFields?: Field[]; // تُشتق تلقائيًا من حقول نشاط الإنتاج المستقل
  rubric?: Rubric;
  authoringNote?: string;
  activities: Activity[];
}

export interface AIConfiguration {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  baseUrl: string; // لمزود متوافق مع OpenAI
  maxTokens: number;
  keyConfigured: boolean;
  keyHint: string; // آخر أربعة محارف فقط
  keySource: 'settings' | 'env' | 'none';
}

export interface AppSettings {
  freeNavigation: boolean; // السماح بالتنقل دون استيفاء المتطلبات (لكل الطالبات)
  peerComments: boolean; // السماح بتعليقات الزميلات على الأعمال المعتمدة
  showTeacherProcedures: boolean; // عرض إجراءات المعلمة للطالبة (افتراضيًا لا)
  aiFeedbackVisibleImmediately: boolean; // ظهور الملاحظات الذكية مباشرة أم بعد مراجعة المعلمة
}

export type ActivityStatus = 'locked' | 'available' | 'in_progress' | 'completed';
