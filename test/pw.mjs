// Shared Playwright helpers for local verification in the sandbox.
// The sandbox cannot reach public CDNs, so CDN requests for three.js are served
// from node_modules. Usage:
//   import { launch, routeCdn } from './scripts/pw.mjs'
//   const browser = await launch(); const page = await browser.newPage(); await routeCdn(page)
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// three.js wherever Node finds it (Orb's node_modules, or a game repository's).
const THREE = path.resolve(path.dirname(createRequire(import.meta.url).resolve('three')), '..');
// Playwright's own Chromium where the sandbox has it, else a Chrome installed on the machine.
export const CHROMIUM = [process.env.ORB_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p)) ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function launch(opts = {}) {
  return chromium.launch({
    executablePath: CHROMIUM,
    // IsolateSandboxedIframes moves sandboxed iframes into another process, where Playwright's
    // request routing (routeCdn) misses some of their requests — keep them in-process for tests.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=IsolateSandboxedIframes'],
    ...opts,
  });
}

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };

// Map https://cdn.jsdelivr.net/npm/three@<ver>/<path> (and unpkg/esm.sh equivalents) to node_modules/three/<path>.
export async function routeCdn(target) {
  const handler = async (route) => {
    const url = new URL(route.request().url());
    const m = url.pathname.match(/^\/(?:npm\/)?three@[^/]+\/(.*)$/);
    if (!m) return route.abort();
    const file = path.join(THREE, m[1]);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' } });
  };
  await target.route(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh)\//, handler);
}
