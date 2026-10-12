// بديل مبسط لـ node:crypto في المعاينة المحلية (البيانات كلها في متصفح المستخدمة نفسها).
function h(str: string): string {
  let out = '';
  for (let k = 0; k < 4; k++) {
    let h1 = 0xdeadbeef ^ k, h2 = 0x41c6ce57 ^ k;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    out += (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}
class Buf { constructor(public s: string, public length: number) {} toString() { return this.s; } }
(globalThis as any).Buffer = { from: (s: string, enc?: string) => new Buf(s, enc === 'hex' ? s.length / 2 : s.length) };
function rnd(n: number) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); }
export function randomBytes(n: number) { return { toString: () => rnd(n) }; }
export function scryptSync(pw: string, salt: string, len: number) { const s = h(pw + ':' + salt).slice(0, len * 2); return new Buf(s, len); }
export function createHmac(_a: string, key: string) { let d = ''; return { update(x: string) { d += x; return this; }, digest() { return h(key + '|' + d); } }; }
export function timingSafeEqual(a: Buf, b: Buf) { return a.s === b.s; }
export function randomInt(n: number) { return Math.floor(Math.random() * n); }
export default { randomBytes, scryptSync, createHmac, timingSafeEqual, randomInt };
