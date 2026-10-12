import { useCallback, useEffect, useState } from 'react';
import { api, clearDrafts } from './api';
import { Ctx, Loading, useOnline, useToasts, type Me } from './ui';
import { useRoute, go } from './router';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { LessonPage } from './pages/Lesson';
import { Portfolio } from './pages/Portfolio';
import { TeacherDashboard } from './teacher/Dashboard';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [aiMode, setAiMode] = useState<'live' | 'demo' | 'off'>('demo');
  const { toast, view } = useToasts();
  const online = useOnline();
  const route = useRoute();

  const load = useCallback(() => {
    api<{ user: Me; ai: { mode: any } }>('/api/me')
      .then((r) => { setMe(r.user); setAiMode(r.ai.mode); })
      .catch((e) => setMe(e.status === 0 ? (me ?? null) : null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = (e: any) => toast(e.detail.msg, e.detail.kind);
    window.addEventListener('ts:toast', t);
    return () => window.removeEventListener('ts:toast', t);
  }, [toast]);
  useEffect(() => {
    const on = () => setMe(null);
    window.addEventListener('ts:unauthorized', on);
    return () => window.removeEventListener('ts:unauthorized', on);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    clearDrafts();
    setMe(null);
    go('');
  }, []);

  if (me === undefined) return <Loading />;
  if (!me) return <>{view}<Login onDone={load} toast={toast} /><footer className="credit">إعداد: تهاني محمد المحياوي</footer></>;

  let page;
  const [a, b, c] = route;
  if (me.role === 'teacher') {
    if (a === 'lesson' && b) page = <LessonPage lessonId={b} activityId={c} />;
    else page = <TeacherDashboard route={route} />;
  } else {
    if (a === 'lesson' && b) page = <LessonPage lessonId={b} activityId={c} />;
    else if (a === 'portfolio') page = <Portfolio />;
    else page = <Home />;
  }

  return (
    <Ctx.Provider value={{ me, aiMode, logout, toast, online }}>
      {page}
      <footer className="credit">إعداد: تهاني محمد المحياوي</footer>
      {view}
    </Ctx.Provider>
  );
}
