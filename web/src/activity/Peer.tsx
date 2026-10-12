// ركن الزميلات: مشاركة تديرها المعلمة. لا يُنشر شيء تلقائيًا، والتعليقات تظهر بعد مراجعتها.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useApp } from '../ui';

const STARTERS = ['أعجبني في عملكِ...', 'فكرتكِ واضحة لأن...', 'استفدتُ من طريقتكِ في...', 'ربما يمكنكِ أيضًا أن...'];

export function PeerCorner({ activityId, prompt, myShares }: { activityId: string; prompt: string; myShares: any[] }) {
  const { toast } = useApp();
  const [gallery, setGallery] = useState<any>(null);
  const [mine, setMine] = useState(myShares);
  const [open, setOpen] = useState(false);
  const load = () => api(`/api/activities/${activityId}/gallery`).then(setGallery).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]);

  async function share() {
    try {
      const r = await api<{ message: string }>(`/api/activities/${activityId}/share`, { body: { anonymous: true } });
      toast(r.message, 'ok');
      setMine([...mine.filter((s) => s.status !== 'pending'), { status: 'pending' }]);
    } catch (e: any) { toast(e.message, 'error'); }
  }

  const status = mine.length ? mine[mine.length - 1].status : null;
  return (
    <section className="card soft" style={{ marginTop: 16 }}>
      <div className="row between">
        <div className="card-title" style={{ margin: 0 }}><Icon name="users" /> ركن الزميلات</div>
        <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'إخفاء' : 'عرض أعمال الزميلات'}</button>
      </div>
      <p className="small" style={{ margin: '6px 0' }}>{prompt}</p>
      <div className="row">
        <button className="btn sm" onClick={share}><Icon name="share" size={16} /> {status ? 'إرسال نسختي الحالية' : 'أرسليها إلى المعلمة للمشاركة'}</button>
        {status === 'pending' && <span className="badge warn">بانتظار موافقة المعلمة</span>}
        {status === 'approved' && <span className="badge ok">شاركتها المعلمة مع الصف</span>}
        {status === 'rejected' && <span className="badge">لم تُعرض هذه المرة</span>}
        <span className="tiny muted">تُعرض باسم مستعار.</span>
      </div>
      {open && gallery && (
        <div className="stack" style={{ marginTop: 12 }}>
          {gallery.items.length === 0 && <p className="small muted">لم تشارك المعلمة أعمالًا في هذا النشاط بعد.</p>}
          {gallery.items.map((it: any) => <ShareItem key={it.id} it={it} commentsEnabled={gallery.commentsEnabled} onDone={load} />)}
        </div>
      )}
    </section>
  );
}

function ShareItem({ it, commentsEnabled, onDone }: { it: any; commentsEnabled: boolean; onDone: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  async function comment() {
    try {
      const r = await api<{ message: string }>(`/api/shares/${it.id}/comments`, { body: { text } });
      toast(r.message, 'ok'); setText(''); onDone();
    } catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <div className="card flat" style={{ padding: 12 }}>
      <div className="small muted" style={{ marginBottom: 4 }}>{it.author}</div>
      <dl className="kv">{Object.entries(it.content).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd className="writing">{String(v)}</dd></div>)}</dl>
      {it.comments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {it.comments.map((c: any) => <div key={c.id} className="small" style={{ borderTop: '1px dashed var(--line)', paddingTop: 4 }}><Icon name="heart" size={13} style={{ verticalAlign: -2, color: 'var(--accent)' }} /> {c.text} {c.pending && <span className="tiny muted">(بانتظار المراجعة)</span>}</div>)}
        </div>
      )}
      {commentsEnabled && !it.mine && (
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 4, marginBottom: 6 }}>{STARTERS.map((s) => <button key={s} className="btn sm ghost" onClick={() => setText(s)}>{s}</button>)}</div>
          <div className="row">
            <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="تعليق داعم ومحدد..." maxLength={400} aria-label="تعليق داعم" />
            <button className="btn sm primary" onClick={comment} disabled={text.trim().length < 3}>إرسال</button>
          </div>
        </div>
      )}
    </div>
  );
}
