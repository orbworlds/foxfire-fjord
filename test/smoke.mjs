#!/usr/bin/env node
// The world's smoke test (made by Orb): it runs through the Orb kit the way Orb runs it, in a
// headless browser, and fails if anything throws or nothing gets drawn. A project with
// tools/package.mjs is packaged first, as Orb serves it.
//
//   npm test
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../orb-kit/lib/server.mjs';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir = root;
if (fs.existsSync(path.join(root, 'tools/package.mjs'))) {
  dir = path.join(root, '.orb-test');
  execFileSync(process.execPath, [path.join(root, 'tools/package.mjs'), dir], { stdio: 'inherit' });
}
const kit = await serve({ dir, port: 0, watch: false, quiet: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
// what a browser without a graphics card says about WebGL isn't the world's fault
const noise = /WebGL|GPU stall|GL_|swiftshader|software rendering|Automatic fallback|AudioContext|Failed to load resource/i;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(kit.url + '?bare', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(Number(process.env.SMOKE_WAIT || 15000));
const world = page.mainFrame().childFrames()[0]; // the kit runs the world in a srcdoc frame, as Orb does
const drawn = world
  ? await world.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (c && c.width > 100 && c.height > 100) return '';
      return document.body && document.body.innerText.trim().length > 0 ? '' : 'nothing on the page';
    }).catch((e) => String(e))
  : 'the world never loaded';
await page.screenshot({ path: path.join(root, 'test/smoke.png'), timeout: 90000 }).catch(() => {});
await browser.close();
await kit.close();
const problems = [...(drawn ? [drawn] : []), ...errors];
for (const p of problems) console.log('✗ ' + p);
console.log(problems.length ? `\n${problems.length} problem${problems.length === 1 ? '' : 's'}` : '✓ it loads, draws, and nothing throws');
process.exit(problems.length ? 1 : 0);
