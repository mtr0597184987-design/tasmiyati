// محرك SQL مصغّر في الذاكرة يحاكي واجهة DatabaseSync من node:sqlite للجزء الذي يستخدمه «تسمياتي» فقط.
// يُستخدم في نسخة المعاينة التي تعمل كاملة داخل المتصفح. يُختبر بتشغيل اختبارات التكامل نفسها فوقه.

type Val = string | number | null;
type Row = Record<string, Val>;

interface Col { name: string; def: Expr | null; pk: boolean; autoinc: boolean }
interface Table { name: string; cols: Col[]; uniques: string[][]; rows: Row[]; seq: number; fks: { col: string; ref: string; refCol: string; cascade: boolean }[] }

// ---------------- المحلل اللفظي ----------------
type Tok = { t: 'id' | 'num' | 'str' | 'op' | 'param'; v: string };
function lex(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === "'") {
      let s = ''; i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (sql[i] === "'") break;
        s += sql[i++];
      }
      i++; out.push({ t: 'str', v: s }); continue;
    }
    if (/[0-9]/.test(c)) { let s = ''; while (i < sql.length && /[0-9.]/.test(sql[i])) s += sql[i++]; out.push({ t: 'num', v: s }); continue; }
    if (/[A-Za-z_]/.test(c)) { let s = ''; while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) s += sql[i++]; out.push({ t: 'id', v: s }); continue; }
    if (c === '?') { out.push({ t: 'param', v: '?' }); i++; continue; }
    const two = sql.slice(i, i + 2);
    if (['!=', '<>', '<=', '>=', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  return out;
}

// ---------------- التعابير ----------------
type Expr =
  | { k: 'lit'; v: Val }
  | { k: 'param'; i: number }
  | { k: 'col'; t?: string; c: string }
  | { k: 'fn'; n: string; a: Expr[]; star?: boolean }
  | { k: 'bin'; o: string; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'isnull'; e: Expr; neg: boolean }
  | { k: 'in'; e: Expr; list: Expr[]; neg: boolean }
  | { k: 'like'; e: Expr; p: Expr; neg: boolean };

const AGG = new Set(['COUNT', 'MAX', 'MIN', 'SUM']);

class P {
  i = 0; pc = 0;
  constructor(public toks: Tok[]) {}
  peek(o = 0) { return this.toks[this.i + o]; }
  kw(w: string, o = 0) { const t = this.peek(o); return !!t && t.t === 'id' && t.v.toUpperCase() === w; }
  op(v: string) { const t = this.peek(); return !!t && t.t === 'op' && t.v === v; }
  eatKw(...ws: string[]) { if (ws.every((w, j) => this.kw(w, j))) { this.i += ws.length; return true; } return false; }
  eatOp(v: string) { if (this.op(v)) { this.i++; return true; } return false; }
  need(v: string) { if (!this.eatOp(v) && !this.eatKw(v)) throw new Error(`minisql: توقعت ${v} عند ${JSON.stringify(this.peek())}`); }
  ident(): string { const t = this.toks[this.i++]; if (!t || t.t !== 'id') throw new Error('minisql: معرف متوقع'); return t.v; }
  done() { return this.i >= this.toks.length || this.op(';'); }

  expr(): Expr { return this.or(); }
  or(): Expr { let l = this.and(); while (this.eatKw('OR')) l = { k: 'bin', o: 'OR', l, r: this.and() }; return l; }
  and(): Expr { let l = this.not(); while (this.eatKw('AND')) l = { k: 'bin', o: 'AND', l, r: this.not() }; return l; }
  not(): Expr { if (this.eatKw('NOT')) return { k: 'not', e: this.not() }; return this.cmp(); }
  cmp(): Expr {
    const l = this.prim();
    if (this.eatKw('IS')) { const neg = this.eatKw('NOT'); this.need('NULL'); return { k: 'isnull', e: l, neg }; }
    const neg = this.eatKw('NOT');
    if (this.eatKw('IN')) { this.need('('); const list: Expr[] = []; if (!this.op(')')) do list.push(this.expr()); while (this.eatOp(',')); this.need(')'); return { k: 'in', e: l, list, neg }; }
    if (this.eatKw('LIKE')) return { k: 'like', e: l, p: this.prim(), neg };
    for (const o of ['=', '!=', '<>', '<=', '>=', '<', '>', '||']) if (this.eatOp(o)) return { k: 'bin', o: o === '<>' ? '!=' : o, l, r: this.prim() };
    return l;
  }
  prim(): Expr {
    const t = this.toks[this.i++];
    if (!t) throw new Error('minisql: نهاية غير متوقعة');
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'param') return { k: 'param', i: this.pc++ };
    if (t.t === 'op' && t.v === '(') { const e = this.expr(); this.need(')'); return e; }
    if (t.t === 'op' && t.v === '-') { const e = this.prim(); return { k: 'bin', o: '-', l: { k: 'lit', v: 0 }, r: e }; }
    if (t.t === 'id') {
      const U = t.v.toUpperCase();
      if (U === 'NULL') return { k: 'lit', v: null };
      if (this.op('(')) {
        this.i++;
        if (this.eatOp('*')) { this.need(')'); return { k: 'fn', n: U, a: [], star: true }; }
        const a: Expr[] = [];
        if (!this.op(')')) do a.push(this.expr()); while (this.eatOp(','));
        this.need(')');
        return { k: 'fn', n: U, a };
      }
      if (this.eatOp('.')) return { k: 'col', t: t.v, c: this.ident() };
      return { k: 'col', c: t.v };
    }
    throw new Error('minisql: رمز غير متوقع ' + t.v);
  }
}

function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function truthy(v: any) { return v !== null && v !== undefined && v !== 0 && v !== false && v !== '0'; }
function cmpVals(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const ta = typeof a === 'number', tb = typeof b === 'number';
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

type Env = Record<string, Row>;
interface Ctx { env: Env; params: any[]; group?: Env[] }

function hasAgg(e: Expr): boolean {
  switch (e.k) {
    case 'fn': return AGG.has(e.n) || e.a.some(hasAgg);
    case 'bin': return hasAgg(e.l) || hasAgg(e.r);
    case 'not': case 'isnull': return hasAgg(e.e);
    case 'in': return hasAgg(e.e);
    case 'like': return hasAgg(e.e);
    default: return false;
  }
}

function lookup(env: Env, t: string | undefined, c: string): Val {
  if (t) { const r = env[t]; if (!r) throw new Error('minisql: جدول غير معروف ' + t); return (r[c] ?? null) as Val; }
  for (const r of Object.values(env)) if (r && c in r) return r[c];
  throw new Error('minisql: عمود غير معروف ' + c);
}

function ev(e: Expr, x: Ctx): any {
  switch (e.k) {
    case 'lit': return e.v;
    case 'param': { const v = x.params[e.i]; return v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v; }
    case 'col': return lookup(x.env, e.t, e.c);
    case 'not': { const v = ev(e.e, x); return v === null ? null : truthy(v) ? 0 : 1; }
    case 'isnull': { const v = ev(e.e, x); return (v === null) !== e.neg ? 1 : 0; }
    case 'in': { const v = ev(e.e, x); if (v === null) return null; const hit = e.list.some((l) => cmpVals(v, ev(l, x)) === 0); return hit !== e.neg ? 1 : 0; }
    case 'like': {
      const v = ev(e.e, x), p = ev(e.p, x);
      if (v === null || p === null) return null;
      const re = new RegExp('^' + String(p).replace(/[.*+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'is');
      return re.test(String(v)) !== e.neg ? 1 : 0;
    }
    case 'bin': {
      if (e.o === 'AND') { const l = ev(e.l, x); if (l !== null && !truthy(l)) return 0; const r = ev(e.r, x); if (r !== null && !truthy(r)) return 0; return l === null || r === null ? null : 1; }
      if (e.o === 'OR') { const l = ev(e.l, x); if (truthy(l)) return 1; const r = ev(e.r, x); if (truthy(r)) return 1; return l === null || r === null ? null : 0; }
      const l = ev(e.l, x), r = ev(e.r, x);
      if (e.o === '||') return l === null || r === null ? null : String(l) + String(r);
      if (e.o === '-') return l === null || r === null ? null : Number(l) - Number(r);
      if (l === null || r === null) return null;
      const c = cmpVals(l, r);
      switch (e.o) { case '=': return c === 0 ? 1 : 0; case '!=': return c !== 0 ? 1 : 0; case '<': return c < 0 ? 1 : 0; case '>': return c > 0 ? 1 : 0; case '<=': return c <= 0 ? 1 : 0; case '>=': return c >= 0 ? 1 : 0; }
      throw new Error('minisql: عامل غير مدعوم ' + e.o);
    }
    case 'fn': {
      if (AGG.has(e.n)) {
        const rows = x.group ?? [x.env];
        if (e.n === 'COUNT') return e.star ? rows.length : rows.filter((env) => ev(e.a[0], { ...x, env, group: undefined }) !== null).length;
        const vals = rows.map((env) => ev(e.a[0], { ...x, env, group: undefined })).filter((v) => v !== null);
        if (!vals.length) return null;
        if (e.n === 'SUM') return vals.reduce((s, v) => s + Number(v), 0);
        return vals.reduce((m, v) => (e.n === 'MAX' ? (cmpVals(v, m) > 0 ? v : m) : (cmpVals(v, m) < 0 ? v : m)));
      }
      const a = e.a.map((y) => ev(y, x));
      switch (e.n) {
        case 'COALESCE': return a.find((v) => v !== null) ?? null;
        case 'DATETIME': return now();
        case 'LOWER': return a[0] === null ? null : String(a[0]).toLowerCase();
        case 'UPPER': return a[0] === null ? null : String(a[0]).toUpperCase();
      }
      throw new Error('minisql: دالة غير مدعومة ' + e.n);
    }
  }
}

// ---------------- العبارات ----------------
type Stmt =
  | { k: 'select'; items: { e?: Expr; star?: string | true; as: string }[]; from: { t: string; a: string }; joins: { t: string; a: string; on: Expr }[]; where?: Expr; group: Expr[]; order: { e: Expr; desc: boolean }[]; limit?: Expr; agg: boolean }
  | { k: 'insert'; t: string; cols: string[]; vals: Expr[]; ignore: boolean; conflict?: { target?: string[]; set?: { c: string; e: Expr }[] } }
  | { k: 'update'; t: string; set: { c: string; e: Expr }[]; where?: Expr }
  | { k: 'delete'; t: string; where?: Expr }
  | { k: 'noop' };

function exprName(e: Expr): string {
  if (e.k === 'col') return e.c;
  if (e.k === 'lit') return String(e.v);
  if (e.k === 'fn') return `${e.n}(${e.star ? '*' : ''})`;
  return '?column?';
}

function parse(sql: string): Stmt {
  const p = new P(lex(sql));
  if (p.eatKw('SELECT')) {
    const items: any[] = [];
    do {
      if (p.eatOp('*')) { items.push({ star: true, as: '*' }); continue; }
      if (p.peek()?.t === 'id' && p.peek(1)?.v === '.' && p.peek(2)?.v === '*') { const t = p.ident(); p.i += 2; items.push({ star: t, as: '*' }); continue; }
      const e = p.expr();
      let as = exprName(e);
      if (p.eatKw('AS')) as = p.ident();
      items.push({ e, as });
    } while (p.eatOp(','));
    p.need('FROM');
    const tbl = () => { const t = p.ident(); let a = t; if (p.peek()?.t === 'id' && !['JOIN', 'WHERE', 'ORDER', 'GROUP', 'LIMIT', 'ON', 'INNER', 'LEFT'].includes(p.peek().v.toUpperCase())) a = p.ident(); return { t, a }; };
    const from = tbl();
    const joins: any[] = [];
    while (p.eatKw('JOIN') || p.eatKw('INNER', 'JOIN')) { const j = tbl(); p.need('ON'); joins.push({ ...j, on: p.expr() }); }
    let where: Expr | undefined; if (p.eatKw('WHERE')) where = p.expr();
    const group: Expr[] = []; if (p.eatKw('GROUP', 'BY')) do group.push(p.expr()); while (p.eatOp(','));
    const order: any[] = [];
    if (p.eatKw('ORDER', 'BY')) do { const e = p.expr(); const desc = p.eatKw('DESC'); if (!desc) p.eatKw('ASC'); order.push({ e, desc }); } while (p.eatOp(','));
    let limit: Expr | undefined; if (p.eatKw('LIMIT')) limit = p.expr();
    return { k: 'select', items, from, joins, where, group, order, limit, agg: group.length > 0 || items.some((it: any) => it.e && hasAgg(it.e)) };
  }
  if (p.eatKw('INSERT')) {
    let ignore = false;
    if (p.eatKw('OR')) { ignore = p.ident().toUpperCase() === 'IGNORE'; }
    p.need('INTO');
    const t = p.ident();
    p.need('('); const cols: string[] = []; do cols.push(p.ident()); while (p.eatOp(',')); p.need(')');
    p.need('VALUES'); p.need('('); const vals: Expr[] = []; do vals.push(p.expr()); while (p.eatOp(',')); p.need(')');
    let conflict: any;
    if (p.eatKw('ON', 'CONFLICT')) {
      conflict = {};
      if (p.eatOp('(')) { conflict.target = []; do conflict.target.push(p.ident()); while (p.eatOp(',')); p.need(')'); }
      p.need('DO');
      if (p.eatKw('NOTHING')) { /* */ } else {
        p.need('UPDATE'); p.need('SET'); conflict.set = [];
        do { const c = p.ident(); p.need('='); conflict.set.push({ c, e: p.expr() }); } while (p.eatOp(','));
      }
    }
    return { k: 'insert', t, cols, vals, ignore, conflict };
  }
  if (p.eatKw('UPDATE')) {
    const t = p.ident(); p.need('SET');
    const set: any[] = []; do { const c = p.ident(); p.need('='); set.push({ c, e: p.expr() }); } while (p.eatOp(','));
    let where: Expr | undefined; if (p.eatKw('WHERE')) where = p.expr();
    return { k: 'update', t, set, where };
  }
  if (p.eatKw('DELETE')) {
    p.need('FROM'); const t = p.ident();
    let where: Expr | undefined; if (p.eatKw('WHERE')) where = p.expr();
    return { k: 'delete', t, where };
  }
  return { k: 'noop' };
}

// ---------------- قاعدة البيانات ----------------
export class DatabaseSync {
  tables: Record<string, Table> = {};
  private snap: string | null = null;
  private cache = new Map<string, Stmt>();
  onWrite: (() => void) | null = null;

  constructor(_path?: string) {}

  serialize(): string { return JSON.stringify(this.tables); }
  load(json: string) {
    const t = JSON.parse(json);
    // تُعاد بناء التعابير الافتراضية من المخطط عند exec، لذا نحتفظ بالصفوف والعدادات فقط
    for (const [name, tb] of Object.entries<any>(t)) if (this.tables[name]) { this.tables[name].rows = tb.rows; this.tables[name].seq = tb.seq; }
  }

  private split(sql: string): string[] {
    const out: string[] = []; let cur = '', q = false, depth = 0;
    for (const ch of sql) {
      if (ch === "'") q = !q;
      if (!q && ch === '(') depth++;
      if (!q && ch === ')') depth--;
      if (!q && depth === 0 && ch === ';') { if (cur.trim()) out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  exec(sql: string) {
    for (const s of this.split(sql)) {
      const U = s.trim().toUpperCase();
      if (U.startsWith('PRAGMA') || U.startsWith('CREATE INDEX')) continue;
      if (U === 'BEGIN') { this.snap = this.serialize(); continue; }
      if (U === 'COMMIT') { this.snap = null; this.onWrite?.(); continue; }
      if (U === 'ROLLBACK') { if (this.snap) { const t = JSON.parse(this.snap); for (const k of Object.keys(t)) { this.tables[k].rows = t[k].rows; this.tables[k].seq = t[k].seq; } } this.snap = null; continue; }
      if (U.startsWith('CREATE TABLE')) { this.createTable(s); continue; }
      this.prepare(s).run();
    }
  }

  private createTable(sql: string) {
    const p = new P(lex(sql));
    p.need('CREATE'); p.need('TABLE');
    p.eatKw('IF', 'NOT', 'EXISTS');
    const name = p.ident();
    if (this.tables[name]) return;
    const tb: Table = { name, cols: [], uniques: [], rows: [], seq: 0, fks: [] };
    p.need('(');
    const skipParens = () => { let d = 0; do { const t = p.toks[p.i++]; if (t.v === '(') d++; if (t.v === ')') d--; } while (d > 0); };
    while (!p.op(')')) {
      if (p.kw('PRIMARY') || p.kw('UNIQUE')) {
        if (p.eatKw('PRIMARY')) p.need('KEY'); else p.i++;
        p.need('('); const cols: string[] = []; do cols.push(p.ident()); while (p.eatOp(',')); p.need(')');
        tb.uniques.push(cols);
      } else {
        const col: Col = { name: p.ident(), def: null, pk: false, autoinc: false };
        while (!p.op(',') && !p.op(')')) {
          if (p.eatKw('PRIMARY')) { p.need('KEY'); col.pk = true; tb.uniques.push([col.name]); }
          else if (p.eatKw('AUTOINCREMENT')) col.autoinc = true;
          else if (p.eatKw('DEFAULT')) { col.def = p.prim(); }
          else if (p.eatKw('UNIQUE')) tb.uniques.push([col.name]);
          else if (p.eatKw('CHECK')) skipParens();
          else if (p.eatKw('REFERENCES')) {
            const ref = p.ident(); p.need('('); const refCol = p.ident(); p.need(')');
            let cascade = false;
            if (p.eatKw('ON', 'DELETE')) cascade = p.ident().toUpperCase() === 'CASCADE';
            tb.fks.push({ col: col.name, ref, refCol, cascade });
          } else p.i++;
        }
        tb.cols.push(col);
      }
      p.eatOp(',');
    }
    this.tables[name] = tb;
  }

  prepare(sql: string) {
    let st = this.cache.get(sql);
    if (!st) { st = parse(sql); this.cache.set(sql, st); }
    const s = st;
    return {
      all: (...params: any[]) => this.select(s, params),
      get: (...params: any[]) => this.select(s, params)[0],
      run: (...params: any[]) => { const r = this.write(s, params); if (!this.snap && r.changes) this.onWrite?.(); return r; },
    };
  }

  private table(n: string) { const t = this.tables[n]; if (!t) throw new Error('minisql: no such table ' + n); return t; }

  private select(s: Stmt, params: any[]): any[] {
    if (s.k !== 'select') { this.write(s, params); return []; }
    let envs: Env[] = this.table(s.from.t).rows.map((r) => ({ [s.from.a]: r }));
    for (const j of s.joins) {
      const rows = this.table(j.t).rows;
      const next: Env[] = [];
      for (const env of envs) for (const r of rows) { const e2 = { ...env, [j.a]: r }; if (truthy(ev(j.on, { env: e2, params }))) next.push(e2); }
      envs = next;
    }
    if (s.where) envs = envs.filter((env) => truthy(ev(s.where!, { env, params })));
    let groups: { env: Env; group?: Env[] }[];
    if (s.agg) {
      if (s.group.length) {
        const m = new Map<string, Env[]>();
        for (const env of envs) { const key = JSON.stringify(s.group.map((g) => ev(g, { env, params }))); if (!m.has(key)) m.set(key, []); m.get(key)!.push(env); }
        groups = [...m.values()].map((g) => ({ env: g[0], group: g }));
      } else groups = [{ env: envs[0] ?? this.nullEnv(s), group: envs }];
    } else groups = envs.map((env) => ({ env }));
    if (s.order.length) {
      groups.sort((a, b) => {
        for (const o of s.order) {
          const c = cmpVals(ev(o.e, { env: a.env, group: a.group, params }), ev(o.e, { env: b.env, group: b.group, params }));
          if (c) return o.desc ? -c : c;
        }
        return 0;
      });
    }
    if (s.limit) groups = groups.slice(0, Number(ev(s.limit, { env: {}, params })));
    return groups.map((g) => {
      const out: Record<string, any> = {};
      for (const it of s.items) {
        if (it.star === true) for (const r of Object.values(g.env)) Object.assign(out, r);
        else if (typeof it.star === 'string') Object.assign(out, g.env[it.star]);
        else out[it.as] = ev(it.e!, { env: g.env, group: g.group, params });
      }
      return out;
    });
  }

  private nullEnv(s: Extract<Stmt, { k: 'select' }>): Env {
    const env: Env = {};
    for (const f of [s.from, ...s.joins]) env[f.a] = Object.fromEntries(this.table(f.t).cols.map((c) => [c.name, null]));
    return env;
  }

  private write(s: Stmt, params: any[]): { changes: number; lastInsertRowid: number } {
    if (s.k === 'noop' || s.k === 'select') return { changes: 0, lastInsertRowid: 0 };
    const tb = this.table(s.t);
    if (s.k === 'insert') {
      const row: Row = {};
      s.cols.forEach((c, i) => (row[c] = ev(s.vals[i], { env: {}, params })));
      for (const c of tb.cols) {
        if (c.autoinc && (row[c.name] === undefined || row[c.name] === null)) row[c.name] = ++tb.seq;
        else if (row[c.name] === undefined) row[c.name] = c.def ? ev(c.def, { env: {}, params: [] }) : null;
        else if (c.autoinc && typeof row[c.name] === 'number' && (row[c.name] as number) > tb.seq) tb.seq = row[c.name] as number;
      }
      const existing = tb.rows.find((r) => tb.uniques.some((u) => u.every((c) => row[c] !== null && cmpVals(r[c], row[c]) === 0)));
      if (existing) {
        if (s.ignore || (s.conflict && !s.conflict.set)) return { changes: 0, lastInsertRowid: 0 };
        if (s.conflict?.set) {
          const env = { [tb.name]: { ...existing }, excluded: row };
          for (const a of s.conflict.set) existing[a.c] = ev(a.e, { env, params });
          return { changes: 1, lastInsertRowid: Number(existing.id ?? 0) };
        }
        throw new Error(`UNIQUE constraint failed: ${tb.name}`);
      }
      tb.rows.push(row);
      return { changes: 1, lastInsertRowid: Number(row.id ?? tb.rows.length) };
    }
    if (s.k === 'update') {
      let n = 0;
      for (const r of tb.rows) {
        const env = { [tb.name]: r };
        if (s.where && !truthy(ev(s.where, { env, params }))) continue;
        const vals = s.set.map((a) => ev(a.e, { env, params }));
        s.set.forEach((a, i) => (r[a.c] = vals[i]));
        n++;
      }
      return { changes: n, lastInsertRowid: 0 };
    }
    // delete مع الحذف المتتالي
    const del = tb.rows.filter((r) => !s.where || truthy(ev(s.where, { env: { [tb.name]: r }, params })));
    this.removeRows(tb, del);
    return { changes: del.length, lastInsertRowid: 0 };
  }

  private removeRows(tb: Table, rows: Row[]) {
    if (!rows.length) return;
    const set = new Set(rows);
    tb.rows = tb.rows.filter((r) => !set.has(r));
    for (const other of Object.values(this.tables)) {
      for (const fk of other.fks) {
        if (fk.ref !== tb.name || !fk.cascade) continue;
        const keys = new Set(rows.map((r) => r[fk.refCol]));
        this.removeRows(other, other.rows.filter((r) => keys.has(r[fk.col])));
      }
    }
  }
}
