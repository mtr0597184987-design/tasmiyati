// يبني نسخة معاينة في ملف HTML واحد: الواجهة نفسها + منطق الخادم نفسه يعمل داخل المتصفح (بلا خادم ولا شبكة).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const P = (f) => path.resolve('preview', f);
const alias = { 'node:sqlite': P('sqlite-browser.ts'), 'node:fs': P('fs-browser.ts'), 'node:path': P('path-browser.ts'), 'node:crypto': P('crypto-browser.ts') };
const r = await esbuild.build({
  entryPoints: ['preview/main-preview.tsx'], bundle: true, minify: true, write: false, format: 'iife', target: ['es2020'],
  jsx: 'automatic', outdir: 'out', loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"', __PREVIEW__: 'true' },
  plugins: [{
    name: 'preview-shims',
    setup(b) {
      b.onResolve({ filter: /^node:/ }, (a) => alias[a.path] ? { path: alias[a.path] } : { path: a.path, external: true });
      b.onResolve({ filter: /\/http\.ts$/ }, (a) => a.importer.includes('/server/') ? { path: P('http-browser.ts') } : undefined);
    },
  }],
});
const js = r.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = r.outputFiles.find((f) => f.path.endsWith('.css')).text.replace(/<\/style/gi, '<\\/style');
const html = `<title>تسمياتي</title>
<meta name="description" content="معاينة تفاعلية لبيئة الكتابة الذكية">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;600&display=swap">
<style>html{direction:rtl}${css}</style>
<div id="root" dir="rtl" lang="ar"><div style="padding:40px;text-align:center">جارٍ تحميل تسمياتي...</div></div>
<script>document.documentElement.lang='ar';document.documentElement.dir='rtl';</script>
<script>${js}</script>
`;
fs.mkdirSync('dist-preview', { recursive: true });
fs.writeFileSync('dist-preview/tasmiyati-preview.html', html);
console.log('dist-preview/tasmiyati-preview.html', (html.length / 1024).toFixed(0) + 'KB');
