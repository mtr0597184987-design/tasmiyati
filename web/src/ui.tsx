import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon, BrandMark } from './icons';
import { href } from './router';

// ---------- السياق العام ----------
export interface Me { id: number; role: 'student' | 'teacher'; label: string; group: string | null }
export interface AppCtx {
  me: Me;
  aiMode: 'live' | 'demo' | 'off';
  logout: () => void;
  toast: (msg: string, kind?: 'ok' | 'error' | 'info') => void;
  online: boolean;
}
export const Ctx = createContext<AppCtx>(null as any);
export const useApp = () => useContext(Ctx);

// ---------- الإشعارات ----------
export function useToasts() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const toast = useCallback((msg: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6500 : 3500);
  }, []);
  const view = (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
    </div>
  );
  return { toast, view };
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

// ---------- عناصر ----------
export function Alert({ kind = 'info', children, icon }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode; icon?: string }) {
  const ic = icon ?? ({ info: 'info', warn: 'alert', danger: 'alert', ok: 'check' } as const)[kind];
  return <div className={`alert ${kind}`} role={kind === 'danger' ? 'alert' : undefined}><Icon name={ic} size={18} /><div>{children}</div></div>;
}

export function Progress({ value, total, label }: { value: number; total: number; label?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'التقدم'}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><Icon name="x" /></button>
        </div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Loading({ text = 'جارٍ التحميل...' }: { text?: string }) {
  return <div className="muted" style={{ padding: 30, textAlign: 'center' }}><span className="typing" style={{ marginInlineEnd: 8 }}><i /><i /><i /></span>{text}</div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div style={{ padding: 20 }}>
      <Alert kind="danger">
        <div>{error}</div>
        {retry && <button className="btn sm" style={{ marginTop: 8 }} onClick={retry}>إعادة المحاولة</button>}
      </Alert>
    </div>
  );
}

export function AiBadge({ mode }: { mode: 'live' | 'demo' | 'off' }) {
  if (mode === 'live') return <span className="badge ok" title="المساعد متصل بنموذج ذكاء اصطناعي عبر الخادم">متصل بالنموذج</span>;
  if (mode === 'demo') return <span className="badge warn" title="لم يُضبط مفتاح النموذج؛ الردود تعرض تسلسل الأسئلة فقط ولا تقيّم الإجابات">وضع تجريبي غير متصل بالنموذج</span>;
  return <span className="badge">المساعد معطل</span>;
}

export function TopBar({ children }: { children?: ReactNode }) {
  const { me, logout, online } = useApp();
  return (
    <>
      <PreviewBar />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href={href(me.role === 'teacher' ? 'teacher' : '')}>
            <BrandMark />
            <span className="brand-name">تسمياتي <span>| بيئة الكتابة الذكية</span></span>
          </a>
          <div className="grow" />
          {children}
          <span className="small muted nowrap" title="اسم مستعار">{me.label}</span>
          <button className="btn ghost sm" onClick={logout}><Icon name="logout" size={18} /> خروج</button>
        </div>
      </header>
      {!online && <div className="net-banner"><Icon name="wifiOff" size={16} style={{ verticalAlign: -3 }} /> لا يوجد اتصال بالإنترنت. ما تكتبينه يُحفظ على هذا الجهاز وسيُرسل عند عودة الاتصال.</div>}
    </>
  );
}

export const STAGE_COLORS = ['', 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)'];

export function fmtDate(s?: string | null) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' } as any);
}

export function downloadUrl(url: string) {
  if (__PREVIEW__) {
    window.dispatchEvent(new CustomEvent('ts:toast', { detail: { msg: 'تنزيل الملفات غير متاح في نسخة المعاينة. يعمل التنزيل في التطبيق المنشور على خادم.', kind: 'info' } }));
    return;
  }
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

export function PreviewBar() {
  if (!__PREVIEW__) return null;
  return (
    <div className="preview-bar">
      <span><b>نسخة معاينة</b> تعمل كاملة داخل متصفحكِ: البيانات تُحفظ على هذا الجهاز فقط، والمساعد في الوضع التجريبي.</span>
      <button className="btn sm" onClick={() => (window as any).__resetPreview?.()}>إعادة ضبط المعاينة</button>
    </div>
  );
}
