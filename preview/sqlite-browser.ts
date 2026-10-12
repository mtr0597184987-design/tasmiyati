// node:sqlite في المتصفح: محرك minisql مع حفظ تلقائي في localStorage لهذا المتصفح فقط.
import { DatabaseSync as Base } from './minisql.ts';
const KEY = 'tasmiyati-preview-db-v1';
export class DatabaseSync extends Base {
  private loaded = false;
  constructor(p?: string) {
    super(p);
    this.onWrite = () => { try { localStorage.setItem(KEY, this.serialize()); } catch { /* التخزين غير متاح */ } };
  }
  exec(sql: string) {
    super.exec(sql);
    if (!this.loaded && Object.keys(this.tables).length) {
      this.loaded = true;
      try { const s = localStorage.getItem(KEY); if (s) this.load(s); } catch { /* */ }
    }
  }
}
export function resetPreviewDb() { try { localStorage.removeItem(KEY); } catch { /* */ } }
