// «منتجاتي السابقة»: تعرض للطالبة أحدث نسخة من منتجاتها في الحصص السابقة لتبني عليها.
import type { Activity } from '../../../shared/types';
import { parseOutline } from '../../../shared/outline';
import { Icon } from '../icons';
import { fmtDate } from '../ui';

export interface Product {
  lessonId: string; number: number; title: string;
  fields: { id: string; label: string; type: string }[];
  data: Record<string, string> | null; version: 'initial' | 'revised' | null; updatedAt: string | null; approvedAt: string | null;
}

export function ProductValue({ type, value }: { type: string; value: string }) {
  if (type === 'outline') {
    const items = parseOutline(value);
    return <ol className="outline-view">{items.map((it, i) => <li key={i}><b>{it.idea}</b>{it.details.length > 0 && <ul>{it.details.map((d, k) => <li key={k}>{d}</li>)}</ul>}</li>)}</ol>;
  }
  return <div className="prod-val">{value || '—'}</div>;
}

export function ProductsPanel({ ids, products }: { ids: string[]; products: Product[] | null }) {
  const list = (products ?? []).filter((p) => ids.includes(p.lessonId));
  return (
    <section className="card soft products-panel" style={{ marginBottom: 14 }}>
      <div className="card-title"><Icon name="folder" /> منتجاتي السابقة</div>
      {!products ? <p className="small muted">جارٍ التحميل...</p> : list.map((p) => (
        <details key={p.lessonId} className="prod" open={list.length === 1}>
          <summary className="row between" style={{ cursor: 'pointer' }}>
            <b>الحصة {p.number}: {p.title}</b>
            <span className="row" style={{ gap: 6 }}>
              {p.approvedAt && <span className="badge ok">اعتمدته المعلمة</span>}
              {p.version ? <span className="badge">{p.version === 'revised' ? 'النسخة المحسنة' : 'النسخة الأولية'}</span> : <span className="badge warn">لم يُسلَّم بعد</span>}
            </span>
          </summary>
          {p.data ? (
            <dl className="kv" style={{ marginTop: 8 }}>
              {p.fields.map((f) => <div key={f.id} style={{ display: 'contents' }}><dt>{f.label}</dt><dd><ProductValue type={f.type} value={p.data![f.id] ?? ''} /></dd></div>)}
            </dl>
          ) : (
            <p className="small muted" style={{ marginTop: 6 }}>
              لم تُسلّمي منتج هذه الحصة بعد. يمكنكِ العودة إليها وإكمالها{p.lessonId === 'L01' ? '، أو العمل على الموضوع البديل: «أثر القراءة اليومية في تنمية المفردات لدى الطالبات»' : ''}.
            </p>
          )}
          {p.updatedAt && <div className="tiny muted">آخر حفظ: {fmtDate(p.updatedAt)}</div>}
        </details>
      ))}
    </section>
  );
}

/** يملأ الحقول الفارغة من منتجات الطالبة السابقة، بحسب إعداد prefill لكل حقل */
export function prefillValues(a: Activity, products: Product[], current: Record<string, any>) {
  const filled: Record<string, string> = {};
  for (const s of a.worksheet.sections) for (const f of s.fields) {
    if (!f.prefill?.length) continue;
    const cur = current[f.id];
    if (cur != null && String(cur).trim() && String(cur) !== f.defaultValue) continue;
    for (const src of f.prefill) {
      const v = products.find((p) => p.lessonId === src.lesson)?.data?.[src.field];
      if (v && v.trim()) { filled[f.id] = v; break; }
    }
  }
  return filled;
}
