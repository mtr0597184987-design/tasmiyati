import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);

// عامل الخدمة لدعم الاتصال الضعيف (في نسخة الإنتاج فقط)
if (!__PREVIEW__ && 'serviceWorker' in navigator && location.protocol !== 'file:' && !/localhost:5\d{3}/.test(location.host)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
