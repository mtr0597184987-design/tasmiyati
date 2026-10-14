// أداة تصميم المخطط: الجدول، وشجرة الذاكرة، وهيكل السمكة. البيانات واحدة (موضوع وأفكار رئيسة وتفصيلات)، ويتغير شكل العرض.
import type { Field, PlannerIdea, PlannerValue } from '../../../shared/types';
import { PLANNER_MODES, parsePlanner } from '../../../shared/outline';
import { Icon } from '../icons';

const ELEMENTS = ['المقدمة', 'العرض', 'الخاتمة'];
const emptyIdea = (): PlannerIdea => ({ element: '', idea: '', details: [''], method: '' });

export function PlannerField({ f, value, onChange, readOnly, label }: { f: Field; value: any; onChange: (v: string) => void; readOnly?: boolean; label: React.ReactNode }) {
  const p = parsePlanner(value);
  const ideas = p.ideas.length ? p.ideas : Array.from({ length: Math.max(1, f.min ?? 3) }, emptyIdea);
  const modes = PLANNER_MODES.filter((m) => !f.plannerModes || f.plannerModes.includes(m.id));
  const set = (patch: Partial<PlannerValue>) => onChange(JSON.stringify({ ...p, ideas, ...patch }));
  const upd = (i: number, patch: Partial<PlannerIdea>) => set({ ideas: ideas.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= ideas.length) return; const n = [...ideas]; [n[i], n[j]] = [n[j], n[i]]; set({ ideas: n }); };

  if (readOnly) return <div className="field">{label}<PlannerView value={{ ...p, ideas }} /></div>;
  return (
    <div className="field planner">
      {label}
      <div className="planner-step">
        <span className="small" style={{ fontWeight: 700 }}>1. أختار شكل التخطيط</span>
        <div className="chips" role="group" aria-label="شكل التخطيط">
          {modes.map((m) => <button type="button" key={m.id} className="chip" aria-pressed={p.mode === m.id} onClick={() => set({ mode: m.id })}>{m.label}</button>)}
        </div>
      </div>
      <label className="planner-step">
        <span className="small" style={{ fontWeight: 700 }}>2. موضوعي (في مركز المخطط أو رأسه)</span>
        <input className="input writing" value={p.topic} maxLength={300} placeholder="اكتبي موضوعكِ" onChange={(e) => set({ topic: e.target.value })} />
      </label>
      <div className="planner-step">
        <span className="small" style={{ fontWeight: 700 }}>3. الأفكار الرئيسة وتفصيلاتها بالترتيب{f.minDetails ? ` (تفصيل واحد على الأقل لكل فكرة)` : ''}</span>
        <datalist id={`el-${f.id}`}>{ELEMENTS.map((e) => <option key={e} value={e} />)}</datalist>
        <ol className="planner-ideas">
          {ideas.map((it, i) => (
            <li key={i} className="planner-idea">
              <div className="row planner-head" style={{ gap: 6 }}>
                <span className="pos">{i + 1}</span>
                <input className="input" style={{ flex: '0 1 130px', minWidth: 100 }} list={`el-${f.id}`} value={it.element} placeholder="العنصر الفني" aria-label={`العنصر الفني للفكرة ${i + 1}`} onChange={(e) => upd(i, { element: e.target.value })} />
                <input className="input writing" style={{ flex: '1 1 200px', minWidth: 0 }} value={it.idea} placeholder="الفكرة الرئيسة" aria-label={`الفكرة الرئيسة ${i + 1}`} onChange={(e) => upd(i, { idea: e.target.value })} />
                <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`تقديم الفكرة ${i + 1}`}><Icon name="up" size={17} /></button>
                <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === ideas.length - 1} aria-label={`تأخير الفكرة ${i + 1}`}><Icon name="down" size={17} /></button>
                {ideas.length > 1 && <button type="button" className="icon-btn" onClick={() => set({ ideas: ideas.filter((_, j) => j !== i) })} aria-label={`حذف الفكرة ${i + 1}`}><Icon name="x" size={17} /></button>}
              </div>
              <div className="outline-details">
                {(it.details.length ? it.details : ['']).map((d, k) => (
                  <div key={k} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <span className="muted">–</span>
                    <input className="input writing grow" value={d} placeholder="تفصيل جزئي" aria-label={`تفصيل ${k + 1} للفكرة ${i + 1}`}
                      onChange={(e) => { const ds = [...(it.details.length ? it.details : [''])]; ds[k] = e.target.value; upd(i, { details: ds }); }} />
                    {it.details.length > 1 && <button type="button" className="icon-btn" onClick={() => upd(i, { details: it.details.filter((_, j) => j !== k) })} aria-label="حذف التفصيل"><Icon name="x" size={15} /></button>}
                  </div>
                ))}
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn sm ghost" onClick={() => upd(i, { details: [...(it.details.length ? it.details : ['']), ''] })}><Icon name="plus" size={14} /> تفصيل</button>
                  <input className="input grow" style={{ minWidth: 140 }} value={it.method} placeholder="أسلوب العرض (اختياري)" aria-label={`أسلوب عرض الفكرة ${i + 1}`} onChange={(e) => upd(i, { method: e.target.value })} />
                </div>
              </div>
            </li>
          ))}
        </ol>
        {ideas.length < 10 && <button type="button" className="btn sm" onClick={() => set({ ideas: [...ideas, emptyIdea()] })}><Icon name="plus" size={16} /> فكرة رئيسة</button>}
      </div>
      <div className="planner-step">
        <span className="small" style={{ fontWeight: 700 }}>معاينة مخططي{p.mode ? `: ${PLANNER_MODES.find((m) => m.id === p.mode)?.label}` : ''}</span>
        {p.mode ? <PlannerView value={{ ...p, ideas }} /> : <p className="small muted">اختاري شكل التخطيط لتظهر المعاينة.</p>}
      </div>
    </div>
  );
}

/** عرض المخطط بالشكل المختار */
export function PlannerView({ value }: { value: PlannerValue }) {
  const ideas = value.ideas.filter((i) => i.idea.trim() || i.details.some((d) => d.trim()));
  const det = (i: PlannerIdea) => i.details.filter((d) => d.trim());
  if (value.mode === 'tree') {
    return (
      <div className="ptree" role="img" aria-label={`شجرة ذاكرة: ${value.topic}`}>
        <div className="ptree-root">{value.topic || 'الموضوع'}</div>
        <div className="ptree-branches">
          {ideas.map((i, k) => (
            <div key={k} className="ptree-branch">
              <div className="ptree-idea">{i.idea}{i.element && <span className="tiny muted"> ({i.element})</span>}</div>
              {det(i).length > 0 && <ul className="ptree-leaves">{det(i).map((d, j) => <li key={j}>{d}</li>)}</ul>}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (value.mode === 'fishbone') {
    const top = ideas.filter((_, k) => k % 2 === 0), bottom = ideas.filter((_, k) => k % 2 === 1);
    const cols = Math.max(1, top.length);
    const bone = (i: PlannerIdea, k: number, pos: 'top' | 'bottom') => (
      <div key={k} className={`pfish-bone ${pos}`}>
        <div className="pfish-idea">{i.idea}{i.element && <span className="tiny muted"> ({i.element})</span>}</div>
        {det(i).length > 0 && <ul>{det(i).map((d, j) => <li key={j}>{d}</li>)}</ul>}
      </div>
    );
    return (
      <div className="table-scroll">
        <div className="pfish" role="img" aria-label={`هيكل سمكة: ${value.topic}`} style={{ ['--cols' as any]: cols }}>
          <div className="pfish-body">
            <div className="pfish-row">{top.map((i, k) => bone(i, k, 'top'))}</div>
            <div className="pfish-spine" />
            <div className="pfish-row">{bottom.map((i, k) => bone(i, k, 'bottom'))}</div>
          </div>
          <div className="pfish-head">{value.topic || 'الموضوع'}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="grid display">
        <caption className="small" style={{ textAlign: 'start', padding: '0 0 6px', fontWeight: 700 }}>{value.topic}</caption>
        <thead><tr><th>العناصر الفنية</th><th>الأفكار الرئيسة</th><th>الأفكار الجزئية</th><th>أسلوب العرض</th></tr></thead>
        <tbody>{ideas.map((i, k) => <tr key={k}><th scope="row">{i.element || '—'}</th><td>{i.idea}</td><td>{det(i).join('، ') || '—'}</td><td>{i.method || '—'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
