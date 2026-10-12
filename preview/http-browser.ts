// بديل موجّه HTTP داخل المتصفح: تُستدعى المسارات نفسها المكتوبة للخادم، دون شبكة.
import { readToken, type SessionUser } from '../server/auth.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export interface Ctx { req: any; res: any; url: URL; params: Record<string, string>; body: any; user: SessionUser | null; secure: boolean }
type Handler = (c: Ctx) => Promise<unknown> | unknown;
const routes: { method: string; re: RegExp; keys: string[]; access: string; handler: Handler }[] = [];
export function route(method: string, pattern: string, access: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, access, handler });
}
export function send(res: any, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (typeof body === 'string') { res.writeHead(status, headers); res.end(body); return; }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body));
}
export function createServer() { throw new Error('not in preview'); }

const SKEY = 'tasmiyati-preview-session';
function getSession() { try { return localStorage.getItem(SKEY) ?? ''; } catch { return ''; } }
function setSession(v: string) { try { v ? localStorage.setItem(SKEY, v) : localStorage.removeItem(SKEY); } catch { /* */ } }

export async function dispatch(method: string, path: string, bodyText: string | null): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const url = new URL(path, 'http://preview.local');
  const res = {
    status: 200, headers: {} as Record<string, string>, body: '', headersSent: false,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    writeHead(s: number, h: Record<string, string> = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; this.headersSent = true; },
    end(b?: string) { this.body = b ?? ''; },
  };
  try {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const user = readToken(getSession());
      if (r.access !== 'public') {
        if (!user) throw new HttpError(401, 'انتهت الجلسة. سجّلي الدخول مرة أخرى.');
        if (r.access !== 'any' && user.role !== r.access) throw new HttpError(403, 'لا تملكين صلاحية الوصول إلى هذه الصفحة.');
      }
      let body: any = {};
      if (bodyText) { try { body = JSON.parse(bodyText); } catch { throw new HttpError(400, 'صيغة البيانات غير صحيحة.'); } }
      if (method === 'PUT' && url.pathname === '/api/teacher/settings' && body?.ai?.apiKey) {
        throw new HttpError(400, 'في نسخة المعاينة لا يُربط النموذج؛ فالمفتاح يجب أن يبقى في خادم حقيقي. اربطيه بعد نشر التطبيق على خادم.');
      }
      const out = await r.handler({ req: { headers: {}, socket: {} }, res, url, params, body, user, secure: false });
      if (!res.headersSent) send(res, 200, out ?? { ok: true });
      break;
    }
    if (!res.headersSent) throw new HttpError(404, 'المسار غير موجود.');
  } catch (e: any) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message, ...e.extra });
    else { console.error(e); send(res, 500, { error: 'حدث خطأ غير متوقع.' }); }
  }
  const c = res.headers['set-cookie'];
  if (c) { const v = c.split(';')[0].split('=')[1] ?? ''; setSession(/Max-Age=0/.test(c) ? '' : v); delete res.headers['set-cookie']; }
  return { status: res.status, headers: res.headers, body: res.body };
}
