// المصادقة والصلاحيات: رموز جلسة موقعة بـ HMAC في ملف تعريف ارتباط HttpOnly.
import crypto from 'node:crypto';
import { get, getSetting, run, setSetting } from './db.ts';

export interface SessionUser { id: number; role: 'student' | 'teacher'; label: string; group: string | null }

function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getSetting<string>('session_secret', '');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('session_secret', s); }
  return s;
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const calc = crypto.scryptSync(pw, salt, 32);
  const expected = Buffer.from(h, 'hex');
  return expected.length === calc.length && crypto.timingSafeEqual(calc, expected);
}

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

export function makeToken(userId: number, role: string): string {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `${userId}.${role}.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [id, role, exp, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${id}.${role}.${exp}`).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const u = get('SELECT id, role, label, group_name FROM users WHERE id = ? AND role = ?', Number(id), role);
  if (!u) return null;
  return { id: u.id, role: u.role, label: u.label, group: u.group_name ?? null };
}

export function sessionCookie(token: string, secure: boolean): string {
  return `ts_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}
export const clearCookie = 'ts_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';

// حماية بسيطة من تخمين رموز الدخول
const attempts = new Map<string, { n: number; until: number }>();
export function rateLimited(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.n >= 8 && a.until > Date.now();
}
export function recordFailure(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 10 * 60_000 });
  else a.n++;
}
export function clearFailures(key: string) { attempts.delete(key); }

/** إنشاء حساب المعلمة عند أول تشغيل */
export function ensureTeacher(): string | null {
  const t = get("SELECT id FROM users WHERE role = 'teacher'");
  if (t) return null;
  const pw = process.env.TEACHER_PASSWORD || crypto.randomBytes(5).toString('hex');
  run("INSERT INTO users(role, code, label, pass_hash) VALUES('teacher', 'teacher', 'المعلمة', ?)", hashPassword(pw));
  return process.env.TEACHER_PASSWORD ? '(من متغير البيئة TEACHER_PASSWORD)' : pw;
}

/** رمز دراسي مستعار مقروء، بلا أحرف ملتبسة */
export function newStudentCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}-${s}`;
}
