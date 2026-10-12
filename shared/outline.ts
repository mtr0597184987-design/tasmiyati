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
