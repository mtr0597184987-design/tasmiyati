// طبقة الاتصال بالخادم، مع رسائل واضحة عند فشل الاتصال، وحفظ محلي للمسودات عند ضعف الشبكة.

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = {}) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحققي من اتصالكِ بالإنترنت.');
  }
  let data: any = {};
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('ts:unauthorized'));
    throw new ApiError(res.status, data.error ?? `حدث خطأ (${res.status}).`, data);
  }
  return data as T;
}

// ---------- مسودات محلية ----------
// تُحفظ إجابات الطالبة على الجهاز فور كتابتها، وتُرسل إلى الخادم عند توفر الاتصال.
const KEY = (sid: string | number, activityId: string) => `ts-draft:${sid}:${activityId}`;

export interface Draft { values: Record<string, any>; dirty: boolean; at: number }

export function readDraft(sid: string | number, activityId: string): Draft | null {
  try {
    const s = localStorage.getItem(KEY(sid, activityId));
    return s ? (JSON.parse(s) as Draft) : null;
  } catch { return null; }
}
export function writeDraft(sid: string | number, activityId: string, d: Draft) {
  try { localStorage.setItem(KEY(sid, activityId), JSON.stringify(d)); } catch { /* التخزين غير متاح */ }
}
export function clearDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('ts-draft:')) localStorage.removeItem(k);
    }
  } catch { /* */ }
}
