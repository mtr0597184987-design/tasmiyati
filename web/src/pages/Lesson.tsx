// شاشة الدرس: العنوان، والمهارات بصياغة مبسطة، وشريط الخطوات السبع، وأنشطة كل خطوة، ومساحة النشاط والمساعد.
import { useCallback, useEffect, useState } from 'react';
import type { Lesson } from '../../../shared/types';
import { api } from '../api';
import { Icon } from '../icons';
import { go, href } from '../router';
import { AiBadge, ErrorBox, Loading, Progress, STAGE_COLORS, TopBar, useApp } from '../ui';
import { ActivityView } from '../activity/ActivityView';
import type { Catalog } from './Home';

export function LessonPage({ lessonId, activityId }: { lessonId: string; activityId?: string }) {
  const { me } = useApp();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, l] = await Promise.all([api<Catalog>('/api/catalog'), api<any>(`/api/lessons/${lessonId}`)]);
      setCat(c); setLesson(l.lesson); setStatuses(l.statuses); setPreview(!!l.preview);
    } catch (e: any) { setError(e.message); }
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  const refreshStatuses = useCallback(async () => {
    try { const l = await api<any>(`/api/lessons/${lessonId}`); setStatuses(l.statuses); setLesson(l.lesson); } catch { /* */ }
  }, [lessonId]);

  const back = <a className="btn ghost sm" href={href(me.role === 'teacher' ? 'teacher/content' : '')}><Icon name="arrowR" size={16} /> {me.role === 'teacher' ? 'لوحة المعلمة' : 'الرئيسة'}</a>;
  if (error) return <><TopBar>{back}</TopBar><ErrorBox error={error} retry={load} /></>;
  if (!lesson || !cat) return <><TopBar>{back}</TopBar><Loading /></>;

  if (!lesson.activities.length) {
    return (
      <>
        <TopBar>{back}</TopBar>
        <main className="container narrow">
          <div className="card"><h1>الحصة {lesson.number}: {lesson.title}</h1><p className="muted">{lesson.authoringNote ?? 'لم يُعدّ محتوى هذه الحصة بعد.'}</p></div>
        </main>
      </>
    );
  }

  const acts = lesson.activities;
  const firstOpen = acts.find((a) => statuses[a.id] !== 'completed' && statuses[a.id] !== 'locked') ?? acts[acts.length - 1];
  let current = acts.find((a) => a.id === activityId) ?? (preview ? acts[0] : firstOpen);
  if (!preview && statuses[current.id] === 'locked') current = firstOpen;
  const idx = acts.indexOf(current);
  const done = Object.values(statuses).filter((s) => s === 'completed').length;
  const stageActs = acts.filter((a) => !a.homework && !current.homework && a.stage === current.stage);
  const hw = acts.filter((a) => a.homework);
  const hwTarget = hw.find((a) => statuses[a.id] !== 'completed' && statuses[a.id] !== 'locked') ?? hw[0];
  const hwLocked = !preview && hw.length > 0 && hw.every((a) => statuses[a.id] === 'locked');
  const nav = (id: string) => go(`lesson/${lesson.id}/${id}`);

  return (
    <>
      <TopBar>{back}{!preview && <AiBadge mode={cat.ai.mode} />}</TopBar>
      <main className="container">
        {preview && <div className="alert warn" style={{ marginBottom: 14 }}><Icon name="eye" size={18} /><div><b>معاينة المعلمة:</b> تعرضين الحصة كما تراها الطالبة، مع إجراءات المعلمة وإعداد المساعد ومفاتيح التلميحات. لا تُحفظ أي إجابات في وضع المعاينة.</div></div>}
        <div className="lesson-head">
          <div>
            <div className="small muted">الدرس المقرر: {lesson.courseLesson.title} · {lesson.durationMinutes} دقيقة</div>
            <h1>الحصة {lesson.number}: {lesson.title}</h1>
            {(lesson.overview || lesson.objectives?.length) && (
              <details className="box lesson-about" style={{ margin: '8px 0' }}>
                <summary><span><Icon name="book" size={16} /> عن الحصة: الفكرة العامة والأهداف{lesson.productLabel ? ` و${lesson.productLabel}` : ''}</span><Icon name="down" size={16} /></summary>
                <div className="body">
                  {lesson.overview && <><h4 style={{ marginTop: 0 }}>فكرة عامة عن الدرس</h4><p className="small">{lesson.overview}</p></>}
                  {lesson.objectives?.length ? <><h4>الأهداف التعليمية</h4>{lesson.objectivesIntro && <p className="small" style={{ marginBottom: 4 }}>{lesson.objectivesIntro}</p>}<ol className="small">{lesson.objectives.map((o, i) => <li key={i}>{o}</li>)}</ol></> : null}
                  {lesson.skillsText && <><h4>مهارات الكتابة</h4><p className="small">{lesson.skillsText}</p></>}
                  {lesson.productLabel && lesson.finalOutput && <><h4>{lesson.productLabel}</h4><p className="small">{lesson.finalOutput}</p></>}
                </div>
              </details>
            )}
            <div className="skill-pills" aria-label="المهارات المستهدفة">
              {lesson.skills.map((s) => <span key={s} className="skill-pill"><Icon name="star" size={13} style={{ verticalAlign: -2, color: 'var(--accent)' }} /> {cat.skills.find((x) => x.id === s)?.studentLabel}</span>)}
            </div>
          </div>
          {!preview && (
            <div style={{ minWidth: 220 }}>
              <div className="small muted" style={{ marginBottom: 4 }}>تقدمكِ في الحصة: {done} من {acts.length}</div>
              <Progress value={done} total={acts.length} label="تقدمكِ في الحصة" />
            </div>
          )}
        </div>

        <nav className="stagebar" aria-label="خطوات الاستراتيجية">
          {cat.stages.map((s) => {
            const sa = acts.filter((a) => !a.homework && a.stage === s.id);
            const allDone = sa.length > 0 && sa.every((a) => statuses[a.id] === 'completed');
            const locked = !preview && sa.every((a) => statuses[a.id] === 'locked');
            const target = preview ? sa[0] : sa.find((a) => statuses[a.id] !== 'completed' && statuses[a.id] !== 'locked') ?? sa[0];
            return (
              <button key={s.id} className={`stage ${current.stage === s.id && !current.homework ? 'current' : ''} ${allDone ? 'done' : ''} ${locked ? 'locked' : ''}`}
                style={{ ['--c' as any]: STAGE_COLORS[s.id] }} disabled={locked || !target} aria-current={current.stage === s.id && !current.homework ? 'step' : undefined}
                title={locked ? 'أكملي الخطوات السابقة أولًا' : s.studentHint} onClick={() => target && nav(target.id)}>
                {allDone && <span className="tick"><Icon name="check" size={16} stroke={2.6} /></span>}
                <span className="num">{s.id}</span>
                <span className="name">{s.name}</span>
              </button>
            );
          })}
          {hw.length > 0 && (
            <button className={`stage homework ${current.homework ? 'current' : ''} ${hw.every((a) => statuses[a.id] === 'completed') ? 'done' : ''} ${hwLocked ? 'locked' : ''}`}
              style={{ ['--c' as any]: 'var(--accent)' }} disabled={hwLocked} aria-current={current.homework ? 'step' : undefined}
              title={hwLocked ? 'يُتاح بعد إكمال المراحل السبع' : lesson.homeworkTitle} onClick={() => hwTarget && nav(hwTarget.id)}>
              {!preview && hw.every((a) => statuses[a.id] === 'completed') && <span className="tick"><Icon name="check" size={16} stroke={2.6} /></span>}
              <span className="num"><Icon name="home" size={15} /></span>
              <span className="name">النشاط البيتي</span>
            </button>
          )}
        </nav>

        {stageActs.length > 1 && (
          <div className="activity-tabs" role="tablist" aria-label="أنشطة الخطوة">
            {stageActs.map((a) => (
              <button key={a.id} className="activity-tab" role="tab" aria-current={a.id === current.id} disabled={!preview && statuses[a.id] === 'locked'} onClick={() => nav(a.id)}>
                {statuses[a.id] === 'completed' ? <Icon name="check" size={15} /> : statuses[a.id] === 'locked' ? <Icon name="lock" size={14} /> : null}
                ({a.id}) {a.title}
              </button>
            ))}
          </div>
        )}

        <ActivityView
          key={current.id}
          lesson={lesson} activity={current} catalog={cat} status={statuses[current.id] ?? 'available'} preview={preview}
          position={{ index: idx, total: acts.length, done }}
          onCompleted={refreshStatuses}
          prevId={acts[idx - 1]?.id} nextId={acts[idx + 1]?.id} onNavigate={nav}
        />
      </main>
    </>
  );
}
