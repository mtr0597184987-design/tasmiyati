// يبني الخادم نفسه فوق محرك minisql بدل node:sqlite، لاختبار محرك المعاينة باختبارات التكامل نفسها.
import * as esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['server/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: 'dist/server-minisql.js',
  plugins: [{ name: 'sqlite-shim', setup(b) { b.onResolve({ filter: /^node:sqlite$/ }, () => ({ path: new URL('../preview/minisql.ts', import.meta.url).pathname })); } }],
});
console.log('built dist/server-minisql.js');
