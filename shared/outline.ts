import type { PlannerValue } from './types.ts';
// المخطط (أفكار رئيسة وتحت كل منها تفصيلات) يُحفظ نصًّا مقروءًا لتسهل مقارنته وقراءته وتصديره:
// 1. الفكرة
//    - تفصيل
export interface OutlineItem { idea: string; details: string[] }

export function parseOutline(s: string | null | undefined): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const raw of String(s ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const idea = line.match(/^(\d+)[.)\-]\s*(.*)$/);
    if (idea) { out.push({ idea: idea[2].trim(), details: [] }); continue; }
    const det = line.match(/^[-–•*]\s*(.*)$/);
    if (det) {
      if (!out.length) out.push({ idea: '', details: [] });
      out[out.length - 1].details.push(det[1].trim());
      continue;
    }
    // سطر بلا علامة: يُعامل فكرة رئيسة
    out.push({ idea: line, details: [] });
  }
  return out;
}

export function serializeOutline(items: OutlineItem[]): string {
  return items.map((it, i) => [`${i + 1}. ${it.idea}`, ...it.details.map((d) => `   - ${d}`)].join('\n')).join('\n');
}

export function outlineStats(s: string | null | undefined) {
  const items = parseOutline(s).filter((i) => i.idea.trim());
  return { ideas: items.length, minDetails: items.length ? Math.min(...items.map((i) => i.details.filter((d) => d.trim()).length)) : 0 };
}

export function wordCount(s: string | null | undefined) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
}
export function paragraphCount(s: string | null | undefined) {
  return String(s ?? '').split(/\n+/).filter((p) => p.trim().split(/\s+/).length >= 5).length;
}

// ---- أداة تصميم المخطط (جدول / شجرة ذاكرة / هيكل سمكة): تُحفظ نصَّ JSON ليبقى المنتج نصًّا ----
export const PLANNER_MODES: { id: 'table' | 'tree' | 'fishbone'; label: string }[] = [
  { id: 'table', label: 'الجدول' },
  { id: 'tree', label: 'شجرة الذاكرة' },
  { id: 'fishbone', label: 'هيكل السمكة' },
];
export function parsePlanner(s: unknown): PlannerValue {
  let v: any = s;
  if (typeof s === 'string') { try { v = JSON.parse(s); } catch { v = null; } }
  const ideas = Array.isArray(v?.ideas) ? v.ideas.slice(0, 12).map((i: any) => ({
    element: String(i?.element ?? '').slice(0, 60), idea: String(i?.idea ?? '').slice(0, 300),
    details: (Array.isArray(i?.details) ? i.details : []).slice(0, 10).map((d: any) => String(d ?? '').slice(0, 300)),
    method: String(i?.method ?? '').slice(0, 120),
  })) : [];
  const mode = ['table', 'tree', 'fishbone'].includes(v?.mode) ? v.mode : '';
  return { mode, topic: String(v?.topic ?? '').slice(0, 300), ideas };
}
export function plannerStats(s: unknown) {
  const p = parsePlanner(s);
  const ideas = p.ideas.filter((i) => i.idea.trim());
  return { mode: p.mode, topic: !!p.topic.trim(), ideas: ideas.length, minDetails: ideas.length ? Math.min(...ideas.map((i) => i.details.filter((d) => d.trim()).length)) : 0 };
}
export function plannerText(s: unknown): string {
  const p = parsePlanner(s);
  const m = PLANNER_MODES.find((x) => x.id === p.mode)?.label ?? 'لم يُحدَّد';
  return `شكل التخطيط: ${m}؛ الموضوع: ${p.topic || '—'}\n` + p.ideas.map((i, k) => `${k + 1}. [${i.element || '—'}] ${i.idea}${i.details.filter(Boolean).length ? ' — التفصيلات: ' + i.details.filter(Boolean).join('، ') : ''}${i.method ? ' — أسلوب العرض: ' + i.method : ''}`).join('\n');
}

// ---- نص المنتج المقروء: تُحفظ الجداول والمخططات في المنتج نصَّ JSON، وتُعرض هنا نصًّا مقروءًا ----
export interface ProductFieldLike { type: string; label?: string; rows?: { id: string; label: string }[]; columns?: { id: string; label: string }[] }
export function parseTable(raw: unknown): Record<string, Record<string, string>> {
  if (raw && typeof raw === 'object') return raw as any;
  try { const v = JSON.parse(String(raw ?? '')); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function productText(f: ProductFieldLike, raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (f.type === 'planner') return plannerText(raw);
  if (f.type === 'outline') return String(raw);
  if (f.type === 'table') {
    const v = parseTable(raw);
    return (f.rows ?? []).map((r) => `${r.label}: ` + (f.columns ?? []).map((c) => `${c.label}: ${v?.[r.id]?.[c.id] || '—'}`).join('؛ ')).join('\n');
  }
  return String(raw);
}
