// موجّه بسيط قائم على الرابط (#/...) — يعمل في أي استضافة ثابتة دون إعدادات خادم إضافية.
import { useEffect, useState } from 'react';

export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export function go(path: string) {
  const h = '#/' + path.replace(/^\/+/, '');
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}

export function href(path: string) { return '#/' + path.replace(/^\/+/, ''); }
