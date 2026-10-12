// نسخ قاعدة البيانات إلى Turso (SQLite سحابية مجانية) لتبقى البيانات دائمة على الاستضافات التي تمسح القرص.
// الطريقة: القاعدة المحلية هي مصدر القراءة السريعة، وكل عملية كتابة تُرسل بالترتيب نفسه إلى Turso.
// عند بدء التشغيل تُستعاد البيانات من Turso، فلا يضيع شيء إذا مُسح القرص المحلي.
// يُفعَّل فقط عند ضبط TURSO_DATABASE_URL و TURSO_AUTH_TOKEN؛ وإلا يعمل التطبيق على القرص المحلي وحده.

type Val = string | number | null;
interface Stmt { sql: string; args: Val[] }

const RAW_URL = process.env.TURSO_DATABASE_URL || '';
const TOKEN = process.env.TURSO_AUTH_TOKEN || '';
export const replicaEnabled = !!(RAW_URL && TOKEN);
const BASE = RAW_URL.replace(/^(libsql|turso|wss?):\/\//, 'https://').replace(/\/$/, '');

const state = { pending: 0, lastSyncAt: null as string | null, lastError: null as string | null, restored: 0, mode: replicaEnabled ? 'turso' : 'local' };
export function replicaStatus() { return { ...state, pending: queue.length }; }

function encode(v: any): any {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  return { type: 'text', value: String(v) };
}
function decode(c: any): Val {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer') return Number(c.value);
  if (c.type === 'float') return Number(c.value);
  if (c.type === 'blob') return c.base64 ?? null;
  return c.value ?? null;
}

async function pipeline(stmts: Stmt[], timeoutMs = 20000): Promise<any[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/v2/pipeline`, {
      method: 'POST', signal: ctrl.signal,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [...stmts.map((s) => ({ type: 'execute', stmt: { sql: s.sql, args: s.args.map(encode) } })), { type: 'close' }] }),
    });
    if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data: any = await res.json();
    return (data.results ?? []).slice(0, stmts.length);
  } finally { clearTimeout(t); }
}

function rowsOf(result: any): Record<string, Val>[] {
  if (result?.type !== 'ok') throw new Error(result?.error?.message ?? 'Turso error');
  const r = result.response.result;
  const cols: string[] = r.cols.map((c: any) => c.name);
  return r.rows.map((row: any[]) => Object.fromEntries(row.map((cell, i) => [cols[i], decode(cell)])));
}

// ---------- طابور الكتابة ----------
const queue: Stmt[] = [];
let sending = false;
let backoff = 1000;

export function enqueue(sql: string, args: any[]) {
  if (!replicaEnabled) return;
  queue.push({ sql, args: args.map((a) => (a === undefined ? null : a)) });
  setImmediate(pump);
}

async function pump() {
  if (sending || !queue.length) return;
  sending = true;
  try {
    while (queue.length) {
      const batch = queue.slice(0, 40);
      let results: any[];
      try {
        results = await pipeline([{ sql: 'PRAGMA foreign_keys = ON', args: [] }, ...batch]);
      } catch (e: any) {
        state.lastError = `تعذّر الاتصال بقاعدة البيانات السحابية: ${e?.message ?? e}`;
        console.error('[replica]', state.lastError);
        setTimeout(pump, backoff);
        backoff = Math.min(backoff * 2, 30000);
        return;
      }
      backoff = 1000;
      results.slice(1).forEach((r, i) => {
        if (r?.type !== 'ok') {
          state.lastError = `رُفضت عملية في القاعدة السحابية: ${r?.error?.message ?? 'خطأ'} — ${batch[i].sql.slice(0, 80)}`;
          console.error('[replica]', state.lastError);
        }
      });
      queue.splice(0, batch.length);
      state.lastSyncAt = new Date().toISOString();
    }
  } finally {
    sending = false;
  }
}

/** انتظار إرسال كل ما في الطابور (عند الإيقاف مثلًا) */
export async function flushReplica(timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while ((queue.length || sending) && Date.now() < until) {
    if (!sending) pump();
    await new Promise((r) => setTimeout(r, 100));
  }
  return queue.length === 0;
}

/**
 * التهيئة عند بدء التشغيل:
 * - تُنشأ الجداول في Turso إن لم تكن موجودة.
 * - إن كانت في Turso بيانات: تُستعاد إلى القاعدة المحلية (Turso هي المرجع).
 * - إن كانت Turso فارغة والقاعدة المحلية فيها بيانات: تُرفع البيانات المحلية إلى Turso (للانتقال من قرص محلي).
 */
export async function initReplica(local: { all: (sql: string) => any[]; exec: (sql: string) => void; insertRow: (table: string, row: Record<string, Val>) => void }, schema: string[], tables: string[]) {
  if (!replicaEnabled) return;
  const created = await pipeline(schema.map((sql) => ({ sql, args: [] })), 60000);
  for (const r of created) if (r?.type !== 'ok') throw new Error('تعذّر إنشاء الجداول في Turso: ' + (r?.error?.message ?? ''));

  const remoteCounts = rowsOf((await pipeline([{ sql: 'SELECT COUNT(*) AS n FROM users', args: [] }]))[0]);
  const remoteUsers = Number(remoteCounts[0]?.n ?? 0);
  const localUsers = Number(local.all('SELECT COUNT(*) AS n FROM users')[0]?.n ?? 0);

  if (remoteUsers === 0 && localUsers > 0) {
    // ترحيل: رفع البيانات المحلية الحالية إلى Turso
    for (const t of tables) {
      const rows = local.all(`SELECT * FROM ${t}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        queue.push({ sql: `INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, args: cols.map((c) => row[c]) });
      }
    }
    await flushReplica(120000);
    console.log('[replica] رُفعت البيانات المحلية إلى القاعدة السحابية.');
    return;
  }

  // استعادة: القاعدة السحابية هي المرجع
  const results = await pipeline(tables.map((t) => ({ sql: `SELECT * FROM ${t}`, args: [] })), 120000);
  local.exec('PRAGMA foreign_keys = OFF');
  local.exec('BEGIN');
  try {
    for (const t of [...tables].reverse()) local.exec(`DELETE FROM ${t}`);
    tables.forEach((t, i) => {
      for (const row of rowsOf(results[i])) { local.insertRow(t, row); state.restored++; }
    });
    local.exec('COMMIT');
  } catch (e) {
    local.exec('ROLLBACK');
    throw e;
  } finally {
    local.exec('PRAGMA foreign_keys = ON');
  }
  state.lastSyncAt = new Date().toISOString();
  console.log(`[replica] استُعيد ${state.restored} سجلًا من القاعدة السحابية.`);
}
