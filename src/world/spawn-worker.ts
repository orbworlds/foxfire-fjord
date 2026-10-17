/**
 * Module workers that also start inside opaque-origin frames.
 *
 * A sandboxed srcdoc iframe (scripts allowed, no same-origin) has the origin
 * "null", so `new Worker(httpUrl)` throws a SecurityError there. A `data:` URL
 * module worker is allowed, and when its body statically imports the absolute
 * script URL the whole relative module graph loads behind it (the host serves
 * modules with permissive CORS). Messages posted right after construction are
 * queued until that graph has evaluated, so callers need no handshake.
 *
 * Usage keeps the literal `new URL('./x.ts', import.meta.url)` at the call site
 * so both the dev server and the packager (which rewrites it to `.js`) see it:
 *
 *   const w = spawnModuleWorker(new URL('./height-worker.ts', import.meta.url));
 *
 * This module must stay free of `three` and other bare imports: the worker
 * graphs import their own helpers without an import map.
 */

let directBroken = false;

/** Worker via a data: URL bootstrap whose body imports `url` (must be absolute). */
export function bootstrapModuleWorker(url: URL): Worker {
  const body = `import ${JSON.stringify(url.href)};`;
  return new Worker(`data:text/javascript;charset=utf-8,${encodeURIComponent(body)}`, { type: 'module' });
}

/**
 * Start a module worker: directly when the page may, otherwise (or once a
 * direct start has failed) through the data: URL bootstrap. Throws only when
 * neither works; callers keep their main-thread fallbacks for that case.
 */
export function spawnModuleWorker(url: URL): Worker {
  if (!directBroken) {
    try {
      return new Worker(url, { type: 'module' });
    } catch {
      directBroken = true;
    }
  }
  return bootstrapModuleWorker(url);
}

/**
 * Report that a directly started worker failed to load asynchronously (its
 * `error` event fired before any message). Returns true when a retry through
 * the bootstrap is worth it, i.e. the failed worker was a direct one.
 */
export function reportWorkerLoadFailure(): boolean {
  if (directBroken) return false;
  directBroken = true;
  return true;
}

/** True when new workers are started through the data: URL bootstrap. */
export function workersViaBootstrap(): boolean {
  return directBroken;
}
