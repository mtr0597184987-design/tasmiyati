import { useState } from 'react';
import { api } from '../api';
import { BrandMark, Icon } from '../icons';
import { Alert, PreviewBar } from '../ui';

export function Login({ onDone }: { onDone: () => void; toast: (m: string, k?: any) => void }) {
  const [mode, setMode] = useState<'student' | 'teacher'>('student');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(mode === 'student' ? '/api/auth/student' : '/api/auth/teacher', { body: mode === 'student' ? { code: value } : { password: value } });
      onDone();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <>
    <PreviewBar />
    <main className="login-wrap">
      <div className="login">
        <div className="brand" style={{ justifyContent: 'center' }}>
          <BrandMark />
          <span className="brand-name" style={{ fontSize: '1.35rem' }}>تسمياتي</span>
        </div>
        <div className="card">
          <h1 style={{ fontSize: '1.3rem', textAlign: 'center' }}>بيئة الكتابة الذكية</h1>
          <p className="muted small" style={{ textAlign: 'center' }}>مرحبًا بكِ. كل كاتبة ماهرة بدأت بخطوة أولى؛ ادخلي لنبدأ خطوتكِ.</p>
          <div className="seg" role="tablist" style={{ width: '100%', margin: '8px 0 16px' }}>
            <button type="button" role="tab" aria-pressed={mode === 'student'} style={{ flex: 1 }} onClick={() => { setMode('student'); setValue(''); setError(''); }}>دخول الطالبة</button>
            <button type="button" role="tab" aria-pressed={mode === 'teacher'} style={{ flex: 1 }} onClick={() => { setMode('teacher'); setValue(''); setError(''); }}>دخول المعلمة</button>
          </div>
          <form onSubmit={submit} className="stack">
            <label className="field">
              <span className="field-label">{mode === 'student' ? 'الرمز الدراسي' : 'كلمة مرور المعلمة'}</span>
              <input
                className="input ltr" style={{ textAlign: 'center', letterSpacing: mode === 'student' ? 2 : 0 }}
                type={mode === 'student' ? 'text' : 'password'} value={value} onChange={(e) => setValue(e.target.value)}
                autoComplete={mode === 'student' ? 'off' : 'current-password'} placeholder={mode === 'student' ? 'مثال: TS-7KQ2X' : ''} required autoFocus
              />
              {mode === 'student' && <span className="field-help">تحصلين على رمزكِ الدراسي من معلمتكِ. لا نطلب اسمكِ الحقيقي.</span>}
            </label>
            {error && <Alert kind="danger">{error}</Alert>}
            <button className="btn primary block lg" disabled={busy || !value.trim()}>
              {busy ? 'جارٍ الدخول...' : 'دخول'} <Icon name="arrowL" size={18} />
            </button>
          </form>
        </div>
        {__PREVIEW__ && (
          <div className="card soft" style={{ marginTop: 14 }}>
            <div className="card-title">بيانات الدخول في المعاينة</div>
            <p className="small" style={{ margin: 0 }}>
              <b>طالبة:</b> اختاري «دخول الطالبة» واكتبي <span className="ltr">DEMO-1</span> أو <span className="ltr">DEMO-2</span> (التنقل بين الأنشطة بالتسلسل)، أو <span className="ltr">DEMO-3</span> (تنقل حر لاستعراض أي نشاط).<br />
              <b>معلمة:</b> اختاري «دخول المعلمة» واكتبي كلمة المرور <span className="ltr">preview</span>.<br />
              <span className="muted">جرّبي دور الطالبة ثم المعلمة لتري ما سجّلته الطالبة في لوحة المتابعة.</span>
            </p>
          </div>
        )}
      </div>
    </main>
    </>
  );
}
