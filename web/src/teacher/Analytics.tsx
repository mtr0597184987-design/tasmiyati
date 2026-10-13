// التقارير والتحليلات: صورة عامة للصف، وملف تقدم لكل طالبة.
// الدرجات كلها من تقديرات المعلمة في سلالم التقدير؛ ولا تُعد قياسًا للدافعية.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { Alert, ErrorBox, Loading, fmtDay } from '../ui';
import { DataTable, HBars, Legend, LineChart, StackedBars } from './charts';

const C = { s1: 'var(--viz-1)', s2: 'var(--viz-2)', done: 'var(--viz-done)', prog: 'var(--viz-prog)', none: 'var(--viz-track)' };
const n1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));
const day = fmtDay;

export function Analytics({ studentId }: { studentId?: string }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => api('/api/teacher/analytics').then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <ErrorBox error={error} retry={load} />;
  if (!d) return <Loading />;
  const who = (s: any) => s.name || s.label;

  return (
    <div className="stack">
      <section className="card no-print">
        <div className="row between">
          <div className="card-title" style={{ margin: 0 }}><Icon name="spark" /> التقارير والتحليلات</div>
          <label className="row small">عرض:
            <select className="input" style={{ width: 'auto', minHeight: 36 }} value={studentId ?? ''} onChange={(e) => go(e.target.value ? `teacher/analytics/${e.target.value}` : 'teacher/analytics')}>
              <option value="">الصف كاملًا</option>
              {d.students.map((s: any) => <option key={s.id} value={s.id}>{who(s)}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>الدرجات مأخوذة من تقديراتكِ في «سلالم التقدير» فقط، على سلم من {d.scale[0].value}. والتقدم محسوب من الأنشطة المكتملة. لا يدخل في الحساب تقدير المساعد الذكي، ولا تُعد هذه الأرقام قياسًا للدافعية.</p>
      </section>

      {studentId ? <StudentReport id={studentId} /> : <ClassReport d={d} who={who} />}
    </div>
  );
}

function ClassReport({ d, who }: { d: any; who: (s: any) => string }) {
  const max = d.scale[0].value;
  const t = d.totals;
  const rated = d.skillRatings.filter((k: any) => k.n > 0);
  const flagged = d.students.filter((s: any) => (s.daysInactive != null && s.daysInactive >= 7) || (s.avgRating != null && s.avgRating < max * 0.625) || !s.lastActive);
  return (
    <>
      <div className="kpis">
        <div className="card kpi"><div className="small muted">الطالبات</div><div className="v">{t.students}</div></div>
        <div className="card kpi"><div className="small muted">متوسط إنجاز الأنشطة</div><div className="v">{t.completionPct}%</div></div>
        <div className="card kpi"><div className="small muted">متوسط التقدير</div><div className="v">{n1(t.avgRating)}<span className="small muted"> / {max}</span></div></div>
        <div className="card kpi"><div className="small muted">التقديرات المسجلة</div><div className="v">{t.ratingsCount}</div><div className="tiny muted">لـ {t.ratedStudents} من {t.students} طالبة</div></div>
      </div>

      {t.students === 0 && <Alert kind="info">لا توجد طالبات بعد. ستظهر الرسوم بعد إضافة الطالبات وبدء العمل.</Alert>}

      <section className="card">
        <div className="card-title">التقدم في الحصص</div>
        <p className="small muted">عدد الطالبات اللاتي أكملن كل حصة، أو بدأنها، أو لم يبدأنها.</p>
        <Legend items={[{ label: 'أكملت الحصة', swatch: C.done }, { label: 'قيد الإنجاز', swatch: C.prog }, { label: 'لم تبدأ', swatch: C.none }]} />
        <StackedBars segments={[{ label: 'أكملت الحصة', color: C.done }, { label: 'قيد الإنجاز', color: C.prog }, { label: 'لم تبدأ', color: C.none }]}
          rows={d.lessonProgress.map((l: any) => ({ key: l.id, label: `الحصة ${l.number}`, values: [l.completed, l.inProgress, l.notStarted] }))} />
        <DataTable head={['الحصة', 'أكملت', 'قيد الإنجاز', 'لم تبدأ']} rows={d.lessonProgress.map((l: any) => [`${l.number}. ${l.title}`, l.completed, l.inProgress, l.notStarted])} />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-title">متوسط التقدير عبر الحصص</div>
          <p className="small muted">هل يتحسن أداء الصف من حصة إلى أخرى؟</p>
          {d.lessonRatings.some((l: any) => l.avg != null)
            ? <LineChart max={max} labels={d.lessonRatings.map((l: any) => `ح${l.number}`)} series={[{ name: 'متوسط الصف', color: C.s1, values: d.lessonRatings.map((l: any) => l.avg) }]} />
            : <Alert kind="info">لم تُسجَّل تقديرات بعد. قدّري الأنشطة من تبويب «سلالم التقدير».</Alert>}
          <DataTable head={['الحصة', 'المتوسط', 'عدد التقديرات']} rows={d.lessonRatings.map((l: any) => [`${l.number}. ${l.title}`, n1(l.avg), l.n])} />
        </section>

        <section className="card">
          <div className="card-title">توزيع المستويات</div>
          <p className="small muted">كم مرة استُخدم كل مستوى في تقديراتكِ.</p>
          <HBars max={Math.max(1, ...d.distribution.map((x: any) => x.count))} valueText={(v) => `${v} تقدير`} empty="0"
            rows={d.distribution.map((x: any) => ({ key: x.value, label: `${x.value} · ${x.label}`, value: x.count }))} />
        </section>
      </div>

      <section className="card">
        <div className="card-title">إتقان المهارات الكتابية</div>
        <p className="small muted">متوسط تقدير الصف في كل مهارة معتمدة، مأخوذًا من بنود السلالم المرتبطة بها. المهارات التي لم تُقدَّر بعد تظهر بلا شريط.</p>
        {rated.length > 0 && (() => {
          const s = [...rated].sort((a: any, b: any) => b.avg - a.avg);
          return <p className="small">الأقوى: <b>{s[0].text}</b>{s.length > 1 && <> · الأحوج إلى دعم: <b>{s[s.length - 1].text}</b></>}</p>;
        })()}
        <HBars max={max} rows={d.skillRatings.map((k: any) => ({ key: k.id, label: `${k.id}. ${k.text}`, value: k.avg, n: k.n }))} />
        <DataTable head={['المهارة', 'المتوسط', 'عدد التقديرات']} rows={d.skillRatings.map((k: any) => [`${k.id}. ${k.text}`, n1(k.avg), k.n])} />
      </section>

      <section className="card">
        <div className="card-title">الطالبات</div>
        {flagged.length > 0 && (
          <Alert kind="warn">
            <b>تحتاج إلى متابعة ({flagged.length}):</b> {flagged.map((s: any) => who(s)).join('، ')}
            <div className="tiny">لم تبدأ بعد، أو لم تعمل منذ 7 أيام فأكثر، أو متوسط تقديرها أقل من {n1(max * 0.625)}.</div>
          </Alert>
        )}
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table className="grid">
            <thead><tr><th>الطالبة</th><th>الإنجاز</th><th>متوسط التقدير</th><th>آخر نشاط</th><th /></tr></thead>
            <tbody>
              {d.students.map((s: any) => {
                const pct = Math.round((s.completed / Math.max(1, s.total)) * 100);
                return (
                  <tr key={s.id}>
                    <td className="nowrap"><b>{who(s)}</b><div className="tiny muted">{s.name ? `${s.label} · ` : ''}<span className="ltr">{s.code}</span></div></td>
                    <td style={{ minWidth: 150 }}>
                      <div className="mini-bar" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></div>
                      <div className="tiny muted">{s.completed} من {s.total} نشاطًا ({pct}%)</div>
                    </td>
                    <td className="nowrap">{s.avgRating != null ? <><b>{n1(s.avgRating)}</b><span className="tiny muted"> / {max} · {s.ratedCount} تقدير</span></> : <span className="muted">لم تُقدَّر</span>}</td>
                    <td className="small nowrap">{s.lastActive ? <>{day(s.lastActive)}{s.daysInactive >= 7 && <span className="badge warn" style={{ marginInlineStart: 6 }}>منذ {s.daysInactive} يومًا</span>}</> : '—'}</td>
                    <td><button className="btn sm" onClick={() => go(`teacher/analytics/${s.id}`)}>تقريرها</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function StudentReport({ id }: { id: string }) {
  const [r, setR] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => { setR(null); api(`/api/teacher/analytics/student/${id}`).then(setR).catch((e) => setError(e.message)); };
  useEffect(() => { load(); }, [id]);
  if (error) return <ErrorBox error={error} retry={load} />;
  if (!r) return <Loading />;
  const max = r.scale[0].value;
  const s = r.summary;
  const name = r.student.name || r.student.label;
  const hasRatings = r.timeline.some((l: any) => l.avg != null);
  return (
    <>
      <section className="card">
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>تقرير {name}</h2>
            <div className="small muted">{r.student.name ? `${r.student.label} · ` : ''}<span className="ltr">{r.student.code}</span> · أُعدّ في {day(new Date().toISOString())}</div>
          </div>
          <div className="row no-print">
            <button className="btn sm" onClick={() => go(`teacher/student/${r.student.id}`)}>صفحة الطالبة وأعمالها</button>
            <button className="btn sm" onClick={() => window.print()}><Icon name="download" size={15} /> طباعة / حفظ PDF</button>
          </div>
        </div>
      </section>

      <div className="kpis">
        <div className="card kpi"><div className="small muted">الأنشطة المكتملة</div><div className="v">{s.completed}<span className="small muted"> / {s.total}</span></div></div>
        <div className="card kpi"><div className="small muted">متوسط تقديرها</div><div className="v">{n1(s.avgRating)}<span className="small muted"> / {max}</span></div><div className="tiny muted">متوسط الصف {n1(s.classAvg)}</div></div>
        <div className="card kpi"><div className="small muted">المنتجات المستقلة</div><div className="v">{s.submissions}</div><div className="tiny muted">حسّنت منها {s.revisions}</div></div>
        <div className="card kpi"><div className="small muted">استعانتها بالدعم</div><div className="v">{s.hints}</div><div className="tiny muted">تلميحًا · {s.messages} رسالة للمساعد</div></div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-title" style={{ color: 'var(--ok)' }}><Icon name="star" /> نقاط القوة</div>
          {r.strengths.length ? <ul className="small" style={{ margin: 0, paddingInlineStart: 20 }}>{r.strengths.map((k: any) => <li key={k.id}>{k.text} <b>({n1(k.avg)})</b></li>)}</ul>
            : <p className="small muted">تظهر هنا المهارات التي بلغ متوسطها {n1(max * 0.75)} فأكثر.</p>}
        </section>
        <section className="card">
          <div className="card-title" style={{ color: 'var(--accent)' }}><Icon name="bulb" /> تحتاج إلى دعم</div>
          {r.needs.length ? <ul className="small" style={{ margin: 0, paddingInlineStart: 20 }}>{r.needs.map((k: any) => <li key={k.id}>{k.text} <b>({n1(k.avg)})</b></li>)}</ul>
            : <p className="small muted">تظهر هنا المهارات التي قلّ متوسطها عن {n1(max * 0.625)}.</p>}
        </section>
      </div>

      <section className="card">
        <div className="card-title">تطور تقديرها عبر الحصص</div>
        {hasRatings ? (
          <>
            <Legend items={[{ label: name, swatch: C.s1, kind: 'line' }, { label: 'متوسط الصف', swatch: C.s2, kind: 'line' }]} />
            <LineChart max={max} labels={r.timeline.map((l: any) => `ح${l.number}`)}
              series={[{ name, color: C.s1, values: r.timeline.map((l: any) => l.avg) }, { name: 'متوسط الصف', color: C.s2, values: r.timeline.map((l: any) => l.classAvg), dashed: true }]} />
          </>
        ) : <Alert kind="info">لم تُقدَّر أنشطتها بعد. قدّريها من تبويب «سلالم التقدير» أو من صفحتها.</Alert>}
      </section>

      <section className="card">
        <div className="card-title">المهارات الكتابية</div>
        <Legend items={[{ label: name, swatch: C.s1 }, { label: 'متوسط الصف', swatch: 'var(--ink-2)', kind: 'tick' }]} />
        <HBars max={max} markerLabel="متوسط الصف" rows={r.skills.map((k: any) => ({ key: k.id, label: `${k.id}. ${k.text}`, value: k.avg, marker: k.classAvg }))} />
        <DataTable head={['المهارة', 'تقديرها', 'متوسط الصف']} rows={r.skills.map((k: any) => [`${k.id}. ${k.text}`, n1(k.avg), n1(k.classAvg)])} />
      </section>

      <section className="card">
        <div className="card-title"><Icon name="clock" /> متى تقدمت؟</div>
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>الحصة</th><th>الأنشطة</th><th>بدأت</th><th>سلّمت المنتج</th><th>حسّنته</th><th>اعتمدتِه</th><th>أكملت الحصة</th><th>تقديرها</th></tr></thead>
            <tbody>
              {r.timeline.map((l: any) => (
                <tr key={l.id}>
                  <td><b>{l.number}</b> <span className="small">{l.title}</span></td>
                  <td className="nowrap small">{l.completed}/{l.total}</td>
                  <td className="nowrap small">{day(l.openedAt)}</td>
                  <td className="nowrap small">{day(l.submittedAt)}</td>
                  <td className="nowrap small">{day(l.revisedAt)}</td>
                  <td className="nowrap small">{l.approvedAt ? <span className="badge ok">{day(l.approvedAt)}</span> : '—'}</td>
                  <td className="nowrap small">{l.completedAt ? <span className="badge ok">{day(l.completedAt)}</span> : '—'}</td>
                  <td className="nowrap small">{n1(l.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
