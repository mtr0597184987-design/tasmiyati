// قاعدة البيانات: SQLite المدمجة في Node.js (node:sqlite) — لا تحتاج إلى أي حزمة خارجية.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { enqueue, initReplica, replicaEnabled } from './replica.ts';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tasmiyati.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('student','teacher')),
  code TEXT UNIQUE,              -- معرف دراسي مستعار للطالبة / اسم دخول للمعلمة
  label TEXT NOT NULL,           -- اسم عرض مستعار مثل «طالبة 01»
  real_name TEXT,                -- اسم تضيفه المعلمة (اختياري): يظهر للمعلمة وللطالبة نفسها فقط، ولا يُرسل إلى النموذج
  group_name TEXT,
  pass_hash TEXT,
  free_navigation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lesson_state (
  lesson_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS overrides (
  target TEXT PRIMARY KEY,       -- activity:1-1 أو rubric:L01
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS progress (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  status TEXT NOT NULL,          -- in_progress | completed
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  unlocked_by_teacher INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, activity_id)
);
CREATE TABLE IF NOT EXISTS responses (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, activity_id, field_id)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  version TEXT NOT NULL CHECK (version IN ('initial','revised')),
  data TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, lesson_id, version)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  role TEXT NOT NULL,            -- student | assistant | system
  content TEXT NOT NULL,
  mode TEXT NOT NULL,            -- ai | demo | scripted
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hint_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai','teacher')),
  data TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teacher_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT,
  note TEXT NOT NULL,
  visible_to_student INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skill_log (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL,
  activity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, skill_id, activity_id)
);
CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  scope TEXT NOT NULL DEFAULT 'class',    -- class | group
  anonymous INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS share_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teacher_ratings (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,    -- بند السلم، أو __note للملاحظة العامة
  level INTEGER,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, activity_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_chat ON chat_messages(student_id, activity_id);
`;
db.exec(SCHEMA);

export type Row = Record<string, any>;

export function all(sql: string, ...params: any[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
export function get(sql: string, ...params: any[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}
// كل كتابة تُنسخ إلى القاعدة السحابية (إن كانت مفعّلة) بالترتيب نفسه
let txBuffer: { sql: string; params: any[] }[] | null = null;
export function run(sql: string, ...params: any[]) {
  const r = db.prepare(sql).run(...params);
  if (replicaEnabled) {
    if (txBuffer) txBuffer.push({ sql, params });
    else enqueue(sql, params);
  }
  return r;
}
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  const outer = txBuffer === null;
  if (outer) txBuffer = [];
  try {
    const r = fn();
    db.exec('COMMIT');
    if (outer) { const b = txBuffer!; txBuffer = null; for (const s of b) enqueue(s.sql, s.params); }
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    if (outer) txBuffer = null;
    throw e;
  }
}

export const TABLES = ['users', 'settings', 'lesson_state', 'overrides', 'progress', 'responses', 'artifacts', 'chat_messages', 'hint_log', 'feedback', 'teacher_notes', 'skill_log', 'shares', 'share_comments', 'teacher_ratings', 'audit_log'];

/** يُستدعى مرة عند بدء الخادم قبل أي كتابة */
export async function initDb() {
  const statements = SCHEMA.split(';').map((x) => x.trim()).filter(Boolean);
  await initReplica({
    all: (sql) => db.prepare(sql).all() as any[],
    exec: (sql) => db.exec(sql),
    insertRow: (t, row) => { const cols = Object.keys(row); db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] as any)); },
  }, statements, TABLES);
  // ترقية قاعدة قائمة: إضافة عمود الاسم إن لم يكن موجودًا
  const cols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map((c) => c.name);
  if (!cols.includes('real_name')) run('ALTER TABLE users ADD COLUMN real_name TEXT');
}

export function getSetting<T>(key: string, fallback: T): T {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}
export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function parse<T = any>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
