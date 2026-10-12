// موجّه HTTP صغير بلا اعتماديات خارجية.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readToken, type SessionUser } from './auth.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: any;
  user: SessionUser | null;
  secure: boolean;
}

type Access = 'public' | 'student' | 'teacher' | 'any';
type Handler = (c: Ctx) => Promise<unknown> | unknown;
interface Route { method: string; re: RegExp; keys: string[]; access: Access; handler: Handler }

const routes: Route[] = [];

export function route(method: string, pattern: string, access: Access, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, access, handler });
}

function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const ch of req) {
    size += (ch as Buffer).length;
    if (size > limit) throw new HttpError(413, 'حجم البيانات المرسلة أكبر من المسموح.');
    chunks.push(ch as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'صيغة البيانات غير صحيحة.'); }
}

export function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function serveStatic(publicDir: string, req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  let file = path.normalize(path.join(publicDir, decodeURIComponent(pathname)));
  if (!file.startsWith(publicDir)) { send(res, 403, 'Forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(publicDir, 'index.html'); // تطبيق صفحة واحدة
  if (!fs.existsSync(file)) { send(res, 404, 'لم يُبنَ التطبيق بعد. شغّلي: npm run build', { 'content-type': 'text/plain; charset=utf-8' }); return; }
  const ext = path.extname(file);
  const immutable = /\/assets\//.test(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

export function createServer(publicDir: string) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket as any).encrypted === true;
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    res.setHeader('referrer-policy', 'same-origin');
    if (!url.pathname.startsWith('/api/')) { serveStatic(publicDir, req, res, url.pathname); return; }
    const started = Date.now();
    try {
      // حماية من الطلبات عبر المواقع: الطلبات المعدِّلة يجب أن تأتي من الأصل نفسه
      if (req.method !== 'GET' && req.headers.origin && req.headers.host && new URL(req.headers.origin).host !== req.headers.host) {
        throw new HttpError(403, 'طلب من مصدر غير مسموح.');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        const user = readToken(cookies(req).ts_session);
        if (r.access !== 'public') {
          if (!user) throw new HttpError(401, 'انتهت الجلسة. سجّلي الدخول مرة أخرى.');
          if (r.access !== 'any' && user.role !== r.access) throw new HttpError(403, 'لا تملكين صلاحية الوصول إلى هذه الصفحة.');
        }
        const body = await readBody(req);
        const out = await r.handler({ req, res, url, params, body, user, secure });
        if (!res.headersSent) send(res, 200, out ?? { ok: true });
        return;
      }
      throw new HttpError(404, 'المسار غير موجود.');
    } catch (e: any) {
      if (e instanceof HttpError) { if (!res.headersSent) send(res, e.status, { error: e.message, ...e.extra }); }
      else { console.error(e); if (!res.headersSent) send(res, 500, { error: 'حدث خطأ غير متوقع في الخادم.' }); }
    } finally {
      if (process.env.LOG_REQUESTS) console.log(req.method, url.pathname, res.statusCode, `${Date.now() - started}ms`);
    }
  });
}
