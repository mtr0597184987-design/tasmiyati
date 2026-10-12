// لوحة المساعد الذكي الموحد. تتغير شخصيته ووظيفته بحسب النشاط، ويُطلب الرد من الخادم فقط.
import { useEffect, useRef, useState } from 'react';
import type { Activity } from '../../../shared/types';
import { api } from '../api';
import { Icon } from '../icons';
import { AiBadge, Alert, STAGE_COLORS, useApp } from '../ui';

interface Msg { role: 'student' | 'assistant'; content: string; mode: string }

export function AssistantPanel({ activity, history, blocked, aiMode, stageIcon, onSent }: {
  activity: Activity;
  history: Msg[];
  blocked: null | 'independent' | 'independent_lesson';
  aiMode: 'live' | 'demo' | 'off';
  stageIcon: string;
  onSent?: () => void;
}) {
  const { online } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(history);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const as = activity.assistant;
  const color = STAGE_COLORS[activity.stage];

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true); setError('');
    setMsgs((m) => [...m, { role: 'student', content: message, mode: 'pending' }]);
    try {
      const r = await api<{ reply: string; mode: string }>(`/api/activities/${activity.id}/chat`, { body: { message } });
      setMsgs((m) => [...m.slice(0, -1), { role: 'student', content: message, mode: r.mode }, { role: 'assistant', content: r.reply, mode: r.mode }]);
      setText('');
      onSent?.();
    } catch (e: any) {
      setMsgs((m) => m.slice(0, -1)); // لم تُحفظ الرسالة؛ تبقى في مربع الكتابة لإعادة المحاولة
      setText(message);
      setError(e.message);
    } finally { setBusy(false); }
  }

  const head = (
    <div className="assistant-head" style={{ ['--c' as any]: color }}>
      <span className="avatar"><Icon name={stageIcon} /></span>
      <div className="grow">
        <div className="assistant-name">{as.name}</div>
        <div style={{ marginTop: 3 }}>{blocked ? <span className="badge"><Icon name="lock" size={13} /> المساعدة التوليدية معطلة</span> : <AiBadge mode={aiMode} />}</div>
      </div>
    </div>
  );

  if (blocked) {
    return (
      <aside className="card assistant" aria-label="المساعد الذكي">
        {head}
        <div className="lock-card">
          <div className="lock-icon"><Icon name="lock" size={28} /></div>
          {blocked === 'independent' ? (
            <>
              <p style={{ fontWeight: 600 }}>{as.opening}</p>
              <p>{as.lockMessage ?? 'ستنجزين هذه المهمة بنفسكِ.'}</p>
              <p className="small muted">المساعدة التوليدية معطلة في هذه المرحلة، ولن يُرسل أي طلب إلى النموذج حتى تسلّمي إنتاجكِ.</p>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 600 }}>المساعد متوقف مؤقتًا</p>
              <p className="small">بدأتِ الإنتاج الكتابي المستقل في هذه الحصة، لذلك تتوقف المساعدة التوليدية في جميع أنشطتها حتى تسلّمي نسختكِ الأولية.</p>
            </>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="card assistant" aria-label="المساعد الذكي">
      {head}
      <div className="messages" ref={box} aria-live="polite">
        <div className="tiny muted" style={{ alignSelf: 'center', textAlign: 'center' }}>أنتِ تحاورين برنامج ذكاء اصطناعي، لا إنسانًا. قد يخطئ أحيانًا، ومعلمتكِ تطّلع على المحادثة. لا تكتبي فيها بيانات شخصية.</div>
        <div className="msg assistant">{as.opening}<span className="meta">رسالة افتتاحية للنشاط</span></div>
        {as.mode !== 'modeling' && as.questions.length > 0 && msgs.length === 0 && (
          <div className="tiny muted" style={{ alignSelf: 'center', textAlign: 'center' }}>اكتبي ردكِ ليبدأ الحوار. سيطرح المساعد سؤالًا واحدًا في كل مرة.</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.role === 'assistant' && m.mode === 'demo' ? 'demo' : ''}`}>
            {m.content}
            {m.role === 'assistant' && m.mode === 'demo' && <span className="meta">وضع تجريبي غير متصل بالنموذج — لا يقيّم الإجابة</span>}
            {m.mode === 'pending' && <span className="meta">جارٍ الإرسال...</span>}
          </div>
        ))}
        {busy && <div className="msg assistant"><span className="typing"><i /><i /><i /></span></div>}
      </div>
      {error && <div style={{ padding: '8px 10px 0' }}><Alert kind="danger"><div>{error}</div><button className="btn sm" style={{ marginTop: 6 }} onClick={() => send(text)}>إعادة المحاولة</button></Alert></div>}
      {aiMode === 'off' ? (
        <div style={{ padding: 12 }}><Alert kind="info">المساعد معطل الآن من إعدادات المعلمة. تابعي العمل في ورقة النشاط، واستعيني بالتلميحات.</Alert></div>
      ) : (
        <>
          {as.quickPrompts?.length ? (
            <div className="quick">
              {as.quickPrompts.map((q) => <button key={q.label} className="btn sm" disabled={busy || !online} onClick={() => send(q.message)}>{q.label}</button>)}
            </div>
          ) : null}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <textarea className="textarea grow" rows={1} value={text} maxLength={1500} placeholder={online ? 'اكتبي ردكِ هنا...' : 'لا يوجد اتصال الآن'}
              aria-label="رسالتكِ إلى المساعد" disabled={!online}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
            <button className="btn primary" disabled={busy || !text.trim() || !online} aria-label="إرسال"><Icon name="send" size={18} /></button>
          </form>
        </>
      )}
    </aside>
  );
}
