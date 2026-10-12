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
export type FieldType = 'text' | 'textarea' | 'choice' | 'chips' | 'classify' | 'table' | 'ordering' | 'list' | 'outline';

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
  rows?: { id: string; label: string }[];
  columns?: { id: string; label: string }[];
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
}

export interface Hint { level: number; kind: string; text: string }

export interface WorksheetSection {
  id?: string;
  title: string;
  intro?: string;
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
  goal: string;
  skills: number[];
  motivation: string[];
  expectedOutput: string;
  teacherProcedures?: string[];
  studentProcedures: string[];
  materials: Material[];
  assistant: AssistantConfig;
  worksheet: { sections: WorksheetSection[] };
  peer?: { enabled: boolean; prompt: string; fields: string[] };
  independent?: boolean;
  evaluation?: { sourceActivity: string };
  portfolio?: 'planningCard';
  showProducts?: string[]; // منتجات حصص سابقة تُعرض للطالبة ويطّلع عليها المساعد
  requirements: { fields: string[]; submitted?: boolean; selfAssessment?: boolean; revised?: boolean; revealAll?: boolean };
}

export interface RubricCriterion { id: string; text: string; skills: number[]; fields: string[] }
export interface Rubric { levels: { id: string; label: string }[]; criteria: RubricCriterion[] }

export interface Lesson {
  id: string;
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
