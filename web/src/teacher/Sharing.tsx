import { useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, ErrorBox, Loading, fmtDate, useApp } from '../ui';

export function Sharing() {
  const { toast } = useApp();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => api('/api/teacher/shares').then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const patch = (url: string, body: any) => api(url, { method: 'PATCH', body }).then(load).catch((e) => toast(e.message, 'error'));

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!d) return <Loading />;
  return (
    <div className="stack">
      <Alert kind="info">لا يُنشر أي عمل تلقائيًا. ترسل الطالبة عملها إليكِ، فتختارين عرضه على الصف، ويظهر باسم مستعار. تعليقات الزميلات تظهر بعد موافقتكِ. يمكنكِ أيضًا اختيار عمل مثالًا من صفحة تفاصيل الطالبة.</Alert>
      <section className="card">
        <div className="card-title">الأعمال المرسلة للمشاركة</div>
        {d.shares.length === 0 && <p className="muted small">لا توجد مشاركات بعد.</p>}
        <div className="stack">
          {d.shares.map((s: any) => (
            <div key={s.id} className="card flat" style={{ padding: 12 }}>
              <div className="row between">
                <span className="small"><b>{s.name || s.label}</b> · النشاط ({s.activity_id}) · {fmtDate(s.created_at)}</span>
                <span className={`badge ${s.status === 'approved' ? 'ok' : s.status === 'pending' ? 'warn' : ''}`}>{s.status === 'approved' ? 'معروضة' : s.status === 'pending' ? 'بانتظار قراركِ' : 'غير معروضة'}</span>
              </div>
              <dl className="kv" style={{ margin: '8px 0' }}>{Object.entries(s.content).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd className="writing">{String(v)}</dd></div>)}</dl>
              <div className="row">
                <button className="btn sm primary" onClick={() => patch(`/api/teacher/shares/${s.id}`, { status: 'approved', scope: 'class' })}>عرض على الصف</button>
                <button className="btn sm" onClick={() => patch(`/api/teacher/shares/${s.id}`, { status: 'rejected' })}>عدم العرض</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="card-title">تعليقات الزميلات</div>
        {d.comments.length === 0 && <p className="muted small">لا توجد تعليقات بعد.</p>}
        <table className="grid">
          <tbody>
            {d.comments.map((c: any) => (
              <tr key={c.id}>
                <td className="small nowrap">{c.name || c.label}<div className="tiny muted">({c.activity_id})</div></td>
                <td>{c.text}</td>
                <td className="nowrap">
                  {c.status === 'pending' ? <>
                    <button className="btn sm primary" onClick={() => patch(`/api/teacher/comments/${c.id}`, { status: 'approved' })}>إظهار</button>{' '}
                    <button className="btn sm" onClick={() => patch(`/api/teacher/comments/${c.id}`, { status: 'rejected' })}>رفض</button>
                  </> : <span className={`badge ${c.status === 'approved' ? 'ok' : ''}`}>{c.status === 'approved' ? 'ظاهر' : 'مرفوض'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
