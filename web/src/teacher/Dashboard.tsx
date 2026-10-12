import { Icon } from '../icons';
import { go } from '../router';
import { TopBar, useApp, AiBadge } from '../ui';
import { Students } from './Students';
import { StudentDetail } from './StudentDetail';
import { Sharing } from './Sharing';
import { Content } from './Content';
import { Settings } from './Settings';

const TABS = [
  { id: '', label: 'الطالبات والتقدم', icon: 'users' },
  { id: 'sharing', label: 'المشاركة والتعليقات', icon: 'share' },
  { id: 'content', label: 'المحتوى والحصص', icon: 'book' },
  { id: 'settings', label: 'الإعدادات والتصدير', icon: 'settings' },
];

export function TeacherDashboard({ route }: { route: string[] }) {
  const { aiMode } = useApp();
  const [, tab = '', id] = route;
  const active = tab === 'student' ? '' : tab;
  return (
    <>
      <TopBar><AiBadge mode={aiMode} /></TopBar>
      <main className="container">
        <h1 style={{ marginBottom: 4 }}>لوحة المعلمة</h1>
        <p className="muted small">تتابعين هنا تقدم الطالبات ومنتجاتهن، وتراجعين الملاحظات الذكية، وتديرين المشاركة والمحتوى. حكمكِ المهني هو المرجع، والملاحظات الذكية مساندة له.</p>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className="tab" role="tab" aria-selected={active === t.id} onClick={() => go(t.id ? `teacher/${t.id}` : 'teacher')}>
              <Icon name={t.icon} size={18} /> {t.label}
            </button>
          ))}
        </div>
        {tab === 'student' && id ? <StudentDetail id={id} /> :
          tab === 'sharing' ? <Sharing /> :
          tab === 'content' ? <Content /> :
          tab === 'settings' ? <Settings /> : <Students />}
      </main>
    </>
  );
}
