#!/usr/bin/env node
// Headless screenshots of the world (Chromium + SwiftShader).
//   node tools/shot.mjs --q "view=house&time=22" --out /path/shot.png [--w 1280 --h 720] [--eval "js"] [--port 5199]
// Several shots in one browser: --q "a" --out a.png --q "b" --out b.png
// Prints page errors and the load report (failed features, timings).
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const one = (name, def) => all(name)[0] ?? def;
const port = one('port', process.env.FOX_PORT || '5199');
const w = Number(one('w', '1280')), h = Number(one('h', '720'));
const timeout = Number(one('timeout', '300000'));
const evals = all('eval');
const qs = all('q'), outs = all('out');
if (!qs.length) qs.push('');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  // CDN libraries (the packaged build) go through the sandbox proxy; the dev server stays local.
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
});
let failed = false;
for (let i = 0; i < qs.length; i++) {
  let q = qs[i];
  if (!/(^|&)shot(=|&|$)/.test(q)) q = `shot=1${q ? `&${q}` : ''}`;
  if (!/(^|&)quality=/.test(q)) q += '&quality=low';
  const out = outs[i] ?? `/tmp/fox-shot-${i}.png`;
  const page = await browser.newPage({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  try {
    await page.goto(`http://127.0.0.1:${port}/?${q}`, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForFunction(() => window.__SCENE_READY__ === true, null, { timeout, polling: 500 });
    const frames = async (n) => {
      const s = await page.evaluate(() => window.__FRAMES__ || 0);
      await page.waitForFunction(([s0, k]) => (window.__FRAMES__ || 0) >= s0 + k, [s, n], { timeout, polling: 200 });
    };
    await frames(6);
    for (const js of evals) { await page.evaluate(js); await frames(6); }
    await page.screenshot({ path: out, timeout });
    const report = await page.evaluate(() => window.__LOAD_REPORT__);
    console.log(`saved ${out} (${q}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (report?.failed?.length) { failed = true; console.log('FAILED FEATURES', JSON.stringify(report.failed.map((f) => [f.id, f.error.split('\n')[0]]))); }
  } catch (e) {
    failed = true;
    console.log(`ERROR ${q}: ${e.message.split('\n')[0]}`);
  }
  if (errors.length) console.log('errors:\n  ' + errors.slice(0, 8).join('\n  '));
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
