// خادم وهمي يحاكي واجهة Turso (Hrana over HTTP: POST /v2/pipeline) فوق SQLite محلية، لاختبار النسخ السحابي.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

export async function startMockTurso(token = 'test-token') {
  const db = new DatabaseSync(':memory:');
  const enc = (v) => v === null || v === undefined ? { type: 'null' } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : typeof v === 'bigint' ? { type: 'integer', value: v.toString() } : { type: 'text', value: String(v) };
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.type === 'float' ? Number(a.value) : a.value;
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url !== '/v2/pipeline' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('unauthorized'); return; }
      calls++;
      const results = JSON.parse(body).requests.map((r) => {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        try {
          const st = db.prepare(r.stmt.sql);
          const args = (r.stmt.args ?? []).map(dec);
          if (/^\s*(SELECT|PRAGMA\s+\w+\s*$)/i.test(r.stmt.sql)) {
            const rows = st.all(...args);
            const cols = rows.length ? Object.keys(rows[0]) : [];
            return { type: 'ok', response: { type: 'execute', result: { cols: cols.map((name) => ({ name })), rows: rows.map((row) => cols.map((c) => enc(row[c]))), affected_row_count: 0, last_insert_rowid: null } } };
          }
          const info = st.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(info.changes), last_insert_rowid: String(info.lastInsertRowid) } } };
        } catch (e) { return { type: 'error', error: { message: e.message } }; }
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}`, token, db, calls: () => calls, close: () => server.close() };
}
