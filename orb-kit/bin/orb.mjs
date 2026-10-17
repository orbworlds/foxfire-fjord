#!/usr/bin/env node
// orb dev [folder]   play the world in that folder (default: here) at http://127.0.0.1:4242
// orb share          the links that open this repository (your fork) on Orb

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '../lib/server.mjs';

const SITE = 'https://orbworlds.com';
const [cmd = 'dev', ...rest] = process.argv.slice(2);

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
}

function orbJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'orb.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** owner/repo of the git remote `origin` on GitHub, or null. */
function githubRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

if (cmd === 'dev') {
  const port = Number(flag('port', process.env.PORT || 4242));
  const host = flag('host', '127.0.0.1');
  const dir = rest[0] || '.';
  try {
    await serve({ dir, port, host });
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is taken: try --port ${port + 1}` : e.message);
    process.exit(1);
  }
} else if (cmd === 'share') {
  const meta = orbJson('.');
  const site = meta.url ? new URL(meta.url).origin : SITE;
  const repo = githubRepo();
  if (!repo) {
    console.log('Push this folder to a public GitHub repository first (git remote "origin").');
    process.exit(1);
  }
  const upstream = meta.repo && meta.repo.toLowerCase() === repo.toLowerCase();
  console.log(`\n  ${meta.name || 'This world'} on Orb\n`);
  if (meta.url) console.log(`  Play the original:     ${meta.url}`);
  if (meta.url) console.log(`  Remix it on Orb:       ${meta.url}?remix`);
  if (!upstream) {
    console.log(`  Play your version:     ${site}/?import=${encodeURIComponent(`github.com/${repo}`)}`);
    console.log('\n  Your version opens as a world of your own on Orb, credited as a remix of the original.');
    console.log('  Push your changes first: Orb imports what is on GitHub.');
  }
  console.log('');
} else {
  console.log('Usage:\n  orb dev [folder] [--port 4242] [--host 127.0.0.1]   play a world locally (two tabs: two players)\n  orb share                                          links that open this repository on Orb');
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
}
