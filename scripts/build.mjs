// بناء الواجهة (React + TypeScript) والخادم باستخدام esbuild.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const watch = process.argv.includes('--watch');
const out = path.resolve('dist/public');
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const webOpts = {
  entryPoints: { app: 'web/src/main.tsx' },
  bundle: true, minify: !watch, sourcemap: watch ? 'inline' : false,
  target: ['es2020'], jsx: 'automatic', format: 'esm',
  outdir: path.join(out, 'assets'), entryNames: watch ? '[name]' : '[name]-[hash]',
  metafile: true, define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __PREVIEW__: 'false' },
  loader: { '.svg': 'text' },
};

function writeHtml(meta) {
  const outputs = Object.keys(meta.outputs).map((f) => path.basename(f));
  const js = outputs.find((f) => f.startsWith('app') && f.endsWith('.js'));
  const css = outputs.find((f) => f.startsWith('app') && f.endsWith('.css'));
  const version = crypto.createHash('sha1').update(outputs.join(',')).digest('hex').slice(0, 10);
  let html = fs.readFileSync('web/index.html', 'utf8')
    .replace('%CSS%', css ? `<link rel="stylesheet" href="/assets/${css}">` : '')
    .replace('%JS%', `<script type="module" src="/assets/${js}"></script>`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  const sw = fs.readFileSync('web/sw.js', 'utf8').replace('%VERSION%', version)
    .replace('%ASSETS%', JSON.stringify(['/', ...outputs.map((f) => `/assets/${f}`)]));
  fs.writeFileSync(path.join(out, 'sw.js'), sw);
  for (const f of ['favicon.svg', 'manifest.webmanifest']) if (fs.existsSync(`web/${f}`)) fs.copyFileSync(`web/${f}`, path.join(out, f));
}

const serverOpts = {
  entryPoints: ['server/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: 'dist/server.js', banner: { js: '// تسمياتي — خادم مبني. المصدر في server/' },
};

if (watch) {
  const ctx = await esbuild.context({ ...webOpts, plugins: [{ name: 'html', setup(b) { b.onEnd((r) => r.metafile && writeHtml(r.metafile)); } }] });
  await ctx.watch();
  console.log('esbuild: مراقبة الواجهة...');
} else {
  const r = await esbuild.build(webOpts);
  writeHtml(r.metafile);
  await esbuild.build(serverOpts);
  const size = (f) => (fs.statSync(f).size / 1024).toFixed(0) + 'KB';
  for (const f of fs.readdirSync(path.join(out, 'assets'))) console.log('  ', f, size(path.join(out, 'assets', f)));
  console.log('تم البناء: dist/public و dist/server.js');
}
