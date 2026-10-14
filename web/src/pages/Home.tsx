import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { href } from '../router';
import { AiBadge, ErrorBox, Loading, Progress, STAGE_COLORS, TopBar, useApp } from '../ui';

export interface Catalog {
  stages: { id: number; key: string; name: string; icon: string; studentHint: string; assistantFunction?: string }[];
  skills: { id: number; domain: string; text: string; studentLabel: string }[];
  domains: { id: string; name: string }[];
  lessons: {
    id: string; number: number; title: string; status: 'authored' | 'draft'; enabled: boolean;
    courseLesson: { number: number; title: string }; skills: number[]; reinforcedSkills: number[]; integratedSkills: number[]; skillsNote?: string;
    durationMinutes: number; finalOutput: string;
    progress: { done: number; total: number; current: null | { id: string; title: string; stage: number; homework?: boolean } };
  }[];
  ai: { mode: 'live' | 'demo' | 'off' };
}

export function Home() {
  const { me } = useApp();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<Catalog>('/api/catalog').then(setCat).catch((e) => setError(e.message)); };
  useEffect(load, []);

  if (error) return <><TopBar /><ErrorBox error={error} retry={load} /></>;
  if (!cat) return <><TopBar /><Loading /></>;

  const available = cat.lessons.filter((l) => l.enabled);
  const current = available.find((l) => l.progress.done < l.progress.total) ?? null;
  const stage = current?.progress.current ? cat.stages.find((s) => s.id === current.progress.current!.stage) : null;
  const groups = [1, 2, 3].map((n) => ({ n, title: cat.lessons.find((l) => l.courseLesson.number === n)?.courseLesson.title ?? '', lessons: cat.lessons.filter((l) => l.courseLesson.number === n) }));
  const totalDone = available.reduce((s, l) => s + l.progress.done, 0);
  const totalAll = available.reduce((s, l) => s + l.progress.total, 0);

  return (
    <>
      <TopBar><AiBadge mode={cat.ai.mode} /></TopBar>
      <main className="container">
        <section className="hero">
          <div>
            <h1>أهلًا بكِ يا {me.label}</h1>
            <p className="muted">هنا تتدربين على مهارات الكتابة خطوة بخطوة: تكتشفين، وتلاحظين، وتخططين، ثم تكتبين بنفسكِ وتحسّنين ما كتبتِ. كل محاولة تقربكِ من الكاتبة التي تريدين أن تكونيها.</p>
            <div className="row">
              <a className="btn" href={href('portfolio')}><Icon name="folder" /> ملف إنجازي الكتابي</a>
              {totalAll > 0 && <span className="small muted">أنجزتِ {totalDone} من {totalAll} مهمة متاحة</span>}
            </div>
          </div>
          <div className="hero-card">
            {current && current.progress.current ? (
              <>
                <div className="small muted">مهمتكِ الحالية</div>
                <h2 style={{ margin: '4px 0' }}>{current.progress.current.title}</h2>
                <p className="small" style={{ opacity: .9 }}>الحصة {current.number}: {current.title}<br />{current.progress.current.homework ? 'النشاط البيتي' : `المرحلة ${stage?.id}: ${stage?.name}`}</p>
                <div style={{ margin: '10px 0 14px' }}><Progress value={current.progress.done} total={current.progress.total} /></div>
                <a className="btn primary lg" href={href(`lesson/${current.id}/${current.progress.current.id}`)}>متابعة التعلم <Icon name="arrowL" size={18} /></a>
              </>
            ) : available.length ? (
              <>
                <h2>أحسنتِ!</h2>
                <p>أنهيتِ جميع المهمات المتاحة. راجعي ملف إنجازكِ، وانتظري الحصة القادمة.</p>
                <a className="btn primary" href={href('portfolio')}>ملف إنجازي الكتابي</a>
              </>
            ) : (
              <>
                <h2>لا توجد حصة متاحة بعد</h2>
                <p>ستتيح معلمتكِ الحصة الأولى في موعدها.</p>
              </>
            )}
          </div>
        </section>

        {groups.map((g) => (
          <section key={g.n} className="course-group">
            <h2>الدرس المقرر {['', 'الأول', 'الثاني', 'الثالث'][g.n]}: <span>{g.title}</span></h2>
            <div className="lessons">
              {g.lessons.map((l) => {
                const done = l.progress.total > 0 && l.progress.done === l.progress.total;
                const status = !l.enabled ? (l.status === 'draft' ? 'قيد الإعداد' : 'لم تُتح بعد') : done ? 'مكتملة' : l.progress.done ? 'قيد الإنجاز' : 'متاحة';
                const cls = !l.enabled ? '' : done ? 'ok' : l.progress.done ? 'warn' : 'primary';
                const inner = (
                  <>
                    <div className="row between">
                      <span className="lesson-num">{l.number}</span>
                      <span className={`badge ${cls}`}>{l.enabled ? null : <Icon name="lock" size={13} />}{status}</span>
                    </div>
                    <h3 style={{ margin: 0 }}>{l.title}</h3>
                    <div className="small muted">{l.skills.map((s) => cat.skills.find((x) => x.id === s)?.studentLabel).filter(Boolean).slice(0, 2).join(' · ')}{l.skills.length > 2 ? ' …' : ''}</div>
                    <div className="grow" />
                    {l.enabled && <><Progress value={l.progress.done} total={l.progress.total} /><div className="tiny muted">{l.progress.done} / {l.progress.total} مهمات</div></>}
                  </>
                );
                return l.enabled
                  ? <a key={l.id} className="card lesson-card" href={href(`lesson/${l.id}`)}>{inner}</a>
                  : <div key={l.id} className="card lesson-card disabled" aria-disabled="true">{inner}</div>;
              })}
            </div>
          </section>
        ))}
        <section className="card soft">
          <div className="card-title"><Icon name="info" /> خطوات «تسمياتي» السبع في كل حصة</div>
          <div className="row" style={{ gap: 8 }}>
            {cat.stages.map((s) => <span key={s.id} className="badge" style={{ borderColor: STAGE_COLORS[s.id] }}><b style={{ color: STAGE_COLORS[s.id] }}>{s.id}</b> {s.name}</span>)}
          </div>
        </section>
      </main>
    </>
  );
}
