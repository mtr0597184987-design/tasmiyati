function join(...a: string[]) { return a.filter(Boolean).join('/').replace(/\/+/g, '/'); }
const path = { join, resolve: join, normalize: (p: string) => p, extname: (p: string) => (p.match(/\.[^./]+$/) ?? [''])[0], basename: (p: string) => p.split('/').pop() ?? '' };
export default path;
export const { resolve, normalize, extname, basename } = path;
export { join };
