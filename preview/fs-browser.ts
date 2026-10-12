// node:fs في المتصفح: ملفات المحتوى مضمّنة وقت البناء.
import strategy from '../content/strategy.json';
import skills from '../content/skills.json';
import motivation from '../content/motivation.json';
import rules from '../content/assistant-rules.json';
import l1 from '../content/lessons/lesson-01.json';
import l2 from '../content/lessons/lesson-02.json';
import l3 from '../content/lessons/lesson-03.json';
import l4 from '../content/lessons/lesson-04.json';
import l5 from '../content/lessons/lesson-05.json';
import l6 from '../content/lessons/lesson-06.json';
import l7 from '../content/lessons/lesson-07.json';
import l8 from '../content/lessons/lesson-08.json';
import l9 from '../content/lessons/lesson-09.json';
const files: Record<string, unknown> = {
  'strategy.json': strategy, 'skills.json': skills, 'motivation.json': motivation, 'assistant-rules.json': rules,
  'lessons/lesson-01.json': l1, 'lessons/lesson-02.json': l2, 'lessons/lesson-03.json': l3, 'lessons/lesson-04.json': l4, 'lessons/lesson-05.json': l5,
  'lessons/lesson-06.json': l6, 'lessons/lesson-07.json': l7, 'lessons/lesson-08.json': l8, 'lessons/lesson-09.json': l9,
};
function find(p: string) { const k = Object.keys(files).find((f) => p.endsWith(f)); if (!k) throw new Error('ENOENT ' + p); return files[k]; }
export function readFileSync(p: string) { return JSON.stringify(find(p)); }
export function readdirSync(p: string) { return p.endsWith('lessons') ? Object.keys(files).filter((f) => f.startsWith('lessons/')).map((f) => f.slice(8)) : []; }
export function mkdirSync() {}
export function existsSync() { return false; }
export default { readFileSync, readdirSync, mkdirSync, existsSync };
