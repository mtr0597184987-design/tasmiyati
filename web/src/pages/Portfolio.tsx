// ملف الإنجاز الكتابي: الأهداف، والبطاقات، والنسخ الأولية والمحسنة، والتقويم، والتغذية الراجعة، والتأملات.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { href } from '../router';
import { ErrorBox, Loading, TopBar, downloadUrl, fmtDate } from '../ui';
import { Compare } from '../activity/Evaluation';
import { ProductValue } from '../activity/Products';

export function Portfolio({ data: given, teacherView }: { data?: any; teacherView?: boolean }) {
  const [d, setD] = useState<any>(given ?? null);
  const [error, setError] = useState('');
  const load = () => { if (given) return; setError(''); api('/api/portfolio').then(setD).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const body = error ? <ErrorBox error={error} retry={load} /> : !d ? <Loading /> : <PortfolioBody d={d} teacherView={teacherView} />;
  if (teacherView) return body;
  return (
    <>
      <TopBar><a className="btn ghost sm" href={href('')}><Icon name="arrowR" size={16} /> الرئيسة</a></TopBar>
      <main className="container narrow">{body}</main>
    </>
  );
}

function PortfolioBody({ d, teacherView }: { d: any; teacherView?: boolean }) {
  const started = d.lessons.filter((l: any) => l.activities.some((a: any) => a.status !== 'not_started'));
  return (
    <div className="stack">
      {!teacherView && (
        <div className="row between">
          <div>
            <h1 style={{ margin: 0 }}>ملف إنجازي الكتابي</h1>
            <div className="muted small">{d.student.label}</div>
          </div>
          <button className="btn" onClick={() => downloadUrl('/api/portfolio/export')}><Icon name="download" size={18} /> تنزيل نسخة (HTML قابلة للطباعة)</button>
        </div>
      )}

      {d.finalText && (
        <section className="card final-text">
          <div className="row between" style={{ marginBottom: 6 }}>
            <span className="card-title" style={{ margin: 0 }}><Icon name="book" /> موضوعي الكامل</span>
            <span className="row" style={{ gap: 6 }}>
              {d.finalText.approvedAt && <span className="badge ok">اعتمدته المعلمة</span>}
              <span className="badge">{d.finalText.version === 'revised' ? 'النسخة النهائية' : 'نسخة ما قبل التغذية الراجعة'}</span>
            </span>
          </div>
          <h2>{d.finalText.title}</h2>
          {[d.finalText.intro, d.finalText.body, d.finalText.conclusion].join('\n').split(/\n+/).filter((p: string) => p.trim()).map((p: string, i: number) => <p key={i}>{p}</p>)}
        </section>
      )}

      {d.journey?.some((j: any) => j.data) && (
        <section className="card">
          <div className="card-title"><Icon name="map" /> رحلة موضوعي: من التخطيط إلى النسخة النهائية</div>
          <ol className="journey">
            {d.journey.map((j: any) => (
              <li key={j.lessonId} className={j.data ? 'done' : ''}>
                <details>
                  <summary className="row between">
                    <span><b>الحصة {j.number}:</b> {j.title}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {j.approvedAt && <span className="badge ok">اعتمدته المعلمة</span>}
                      {j.data ? <span className="badge">{j.version === 'revised' ? 'محسن' : 'أولي'}</span> : <span className="badge">لم يُنجز بعد</span>}
                    </span>
                  </summary>
                  {j.data && <dl className="kv" style={{ marginTop: 8 }}>{j.fields.map((f: any) => <div key={f.id} style={{ display: 'contents' }}><dt>{f.label}</dt><dd><ProductValue type={f.type} field={f} value={j.data[f.id] ?? ''} /></dd></div>)}</dl>}
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <div className="card-title"><Icon name="star" /> المهارات التي تدربتُ عليها</div>
        {d.skills.length === 0 ? <p className="muted small">ستظهر هنا بعد إكمال أول نشاط.</p> : (
          <ul style={{ margin: 0 }}>{d.skills.map((s: any) => <li key={s.id}>{s.text} <span className="tiny muted">({s.activities} {s.activities > 2 ? 'أنشطة' : 'نشاط'})</span></li>)}</ul>
        )}
      </section>

      {started.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>لم تبدئي العمل في الحصص بعد.</p></div>}

      {started.map((l: any) => (
        <section key={l.id} className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>الحصة {l.number}: {l.title}</h2>
            {l.completed ? <span className="badge ok">مكتملة</span> : <span className="badge warn">قيد الإنجاز</span>}
          </div>
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="grid">
              <thead><tr><th>النشاط</th><th>الحالة</th><th>تاريخ الإكمال</th></tr></thead>
              <tbody>{l.activities.map((a: any) => (
                <tr key={a.id}><td>{a.book ? 'من كتاب الطالبة: ' : `(${a.id}) `}{a.title}</td><td>{a.status === 'completed' ? <span className="badge ok">مكتمل</span> : a.status === 'in_progress' ? <span className="badge warn">قيد الإنجاز</span> : <span className="muted">—</span>}</td><td className="small">{fmtDate(a.completedAt)}</td></tr>
              ))}</tbody>
            </table>
          </div>

          {l.goals.length > 0 && <><h3 style={{ marginTop: 16 }}>أهدافي الشخصية</h3><ul>{l.goals.map((g: string, i: number) => <li key={i} className="writing">{g}</li>)}</ul></>}

          {l.planningCards.map((p: any, i: number) => (
            <div key={i}>
              <h3 style={{ marginTop: 16 }}>بطاقة التخطيط</h3>
              <dl className="kv">{p.rows.map((r: any) => <div key={r.label} style={{ display: 'contents' }}><dt>{r.label}</dt><dd className="writing">{r.value}</dd></div>)}</dl>
            </div>
          ))}

          {l.product && (
            <>
              <h3 style={{ marginTop: 16 }}>منتجي الكتابي</h3>
              <p className="small muted">النسخة الأصلية: {fmtDate(l.product.initialAt)}{l.product.revisedAt ? ` · المحسنة: ${fmtDate(l.product.revisedAt)}` : ''}</p>
              <Compare fields={l.product.fields} a={l.product.initial} b={l.product.revised ?? l.product.initial} />
              {!l.product.revised && <p className="small muted">لم تُحفظ نسخة محسنة بعد.</p>}
            </>
          )}

          {l.selfAssessment.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>تقويمي الذاتي</h3>
              <table className="grid"><tbody>{l.selfAssessment.map((s: any, i: number) => <tr key={i}><td>{s.criterion}</td><td className="nowrap"><b>{s.level}</b></td><td className="small">{s.note}</td></tr>)}</tbody></table>
            </>
          )}

          {l.feedback.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>التغذية الراجعة</h3>
              {l.feedback.map((f: any, i: number) => (
                <div key={i} className="card soft" style={{ marginBottom: 8 }}>
                  <div className="small" style={{ fontWeight: 700 }}>{f.source === 'ai' ? 'ملاحظات المساعد التشخيصية' : 'ملاحظات المعلمة'} <span className="tiny muted">{fmtDate(f.createdAt)}</span></div>
                  {f.data.raw && <p className="small">{f.data.raw}</p>}
                  {f.data.text && <p className="small">{f.data.text}</p>}
                  {(f.data.criteria ?? []).map((c: any) => <div key={c.id} className="small">• <b>{f.criteria.find((x: any) => x.id === c.id)?.text}</b> {c.observation} {c.question && <em className="muted">{c.question}</em>}</div>)}
                </div>
              ))}
            </>
          )}

          {l.reflections.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>تأملاتي</h3>
              {l.reflections.map((r: any, i: number) => <div key={i} style={{ marginBottom: 8 }}><div className="small muted">{r.question}</div><div className="writing">{r.text}</div></div>)}
            </>
          )}
          {l.teacherNotes.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>ملاحظات معلمتي</h3>
              {l.teacherNotes.map((n: any, i: number) => <p key={i} className="small">{n.note}</p>)}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
