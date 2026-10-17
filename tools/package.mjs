#!/usr/bin/env node
// Packages the world as a no-build web project: every TypeScript module is transpiled on its own
// to a plain ES module (comments kept, imports pointed at .js files), the styles are copied, and
// index.html gets an import map for the libraries. The result runs from any static host —
// including Orb, which serves each file from a content-addressed tree.
//
//   node tools/package.mjs [outDir=out]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'out');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ver = (name) => pkg.dependencies[name];

export const IMPORT_MAP = {
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${ver('three')}/build/three.module.js`,
    'three/addons/': `https://cdn.jsdelivr.net/npm/three@${ver('three')}/examples/jsm/`,
    'three/examples/jsm/': `https://cdn.jsdelivr.net/npm/three@${ver('three')}/examples/jsm/`,
    postprocessing: `https://cdn.jsdelivr.net/npm/postprocessing@${ver('postprocessing')}/build/index.js`,
    n8ao: `https://cdn.jsdelivr.net/npm/n8ao@${ver('n8ao')}/dist/N8AO.js`,
  },
};

const src = path.join(root, 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(src);

/** './x' → './x.js' or './x/index.js'; CSS imports are dropped (index.html links the styles). */
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return spec;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (/\.tsx?$/.test(spec)) return spec.replace(/\.tsx?$/, '.js');
  if (/\.(js|css|json)$/.test(spec)) return spec;
  if (fs.existsSync(`${base}.ts`)) return `${spec}.js`;
  if (fs.existsSync(path.join(base, 'index.ts'))) return `${spec}/index.js`;
  throw new Error(`${path.relative(root, fromFile)}: cannot resolve ${spec}`);
}

function rewrite(fromFile, code) {
  code = code.replace(/^import\s+(['"])[^'"]+\.css\1;?\s*$/gm, '');
  code = code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_, pre, q, spec) => `${pre}${q}${resolveSpec(fromFile, spec)}${q}`);
  code = code.replace(/new URL\((['"])(\.{1,2}\/[^'"]+)\.ts\1,\s*import\.meta\.url\)/g, (_, q, spec) => `new URL(${q}${spec}.js${q}, import.meta.url)`);
  return code;
}

fs.rmSync(out, { recursive: true, force: true });
let count = 0, bytes = 0;
for (const file of files) {
  const rel = path.relative(src, file);
  if (rel.endsWith('.d.ts')) continue;
  let dest = path.join(out, rel), text;
  if (rel.endsWith('.ts')) {
    const res = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: true, verbatimModuleSyntax: false, removeComments: false, sourceMap: false },
    });
    if (res.diagnostics?.length) throw new Error(`${rel}: ${ts.flattenDiagnosticMessageText(res.diagnostics[0].messageText, '\n')}`);
    dest = dest.replace(/\.ts$/, '.js');
    text = rewrite(file, res.outputText).replace(/\n{3,}/g, '\n\n');
  } else {
    text = fs.readFileSync(file, 'utf8');
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  count++;
  bytes += Buffer.byteLength(text);
}

// index.html: the dev page with the libraries mapped, the styles linked and main.js as the entry.
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = `    <script type="importmap">${JSON.stringify(IMPORT_MAP)}</script>\n    <link rel="stylesheet" href="./styles/main.css" />\n`;
html = html.replace('</head>', `${head}  </head>`).replace(/<script type="module" src="\/src\/main\.ts"><\/script>/, '<script type="module" src="./main.js"></script>');
if (!html.includes('./main.js')) throw new Error('index.html: entry script not found');
fs.writeFileSync(path.join(out, 'index.html'), html);
count++;
console.log(`packaged ${count} files (${Math.round(bytes / 1024)} KB) → ${path.relative(process.cwd(), out) || '.'}`);
