/**
 * The material library's procedural textures, generated in the background.
 * As soon as the quality preset is known, a few module workers start running
 * the generators of core/textures.ts (on OffscreenCanvas), so by the time the
 * features build their materials most pixels are waiting and the main thread
 * only uploads them. Anything not ready in time, or a browser without module
 * workers or OffscreenCanvas, falls back to generating on the main thread as
 * before. Untaken results are dropped once the features have loaded.
 */
import { reportWorkerLoadFailure, spawnModuleWorker } from '../world/spawn-worker.js';
const keyOf = (c) => `${c[0]}:${JSON.stringify(c[1])}`;
class TexturePool {
    /** worker time spent generating so far (ms, summed over the workers) and the jobs done */
    stats = { ms: 0, jobs: 0, used: 0 };
    done = new Map();
    known = new Set();
    taken = new Set();
    queue = [];
    workers = [];
    idle = [];
    running = 0;
    broken = false;
    retried = false;
    waiters = [];
    /** Queue generator calls (duplicates and calls already queued are ignored); resolves when the queue drains. */
    prefetch(calls, maxWorkers = 3) {
        if (this.broken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined')
            return Promise.resolve();
        for (const call of calls) {
            const key = keyOf(call);
            if (this.known.has(key))
                continue;
            this.known.add(key);
            this.queue.push({ key, call });
        }
        // leave a core for the main thread and one for the GPU driver
        const want = Math.max(1, Math.min(maxWorkers, (navigator.hardwareConcurrency || 4) - 2));
        while (this.workers.length < want && !this.broken)
            this.spawn();
        this.pump();
        return this.drained();
    }
    /** The pixels of a finished call (once; null when not ready: generate on the main thread). */
    take(call) {
        const key = keyOf(call);
        this.taken.add(key);
        const hit = this.done.get(key);
        if (hit) {
            this.done.delete(key);
            this.stats.used++;
        }
        // still queued: nobody needs it from the worker any more
        const qi = this.queue.findIndex((j) => j.key === key);
        if (qi >= 0)
            this.queue.splice(qi, 1);
        return hit ?? null;
    }
    /** Drop everything not taken and stop the workers. */
    release() {
        this.done.clear();
        this.queue.length = 0;
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.idle = [];
        this.running = 0;
        this.wake();
    }
    drained() {
        if (!this.queue.length && !this.running)
            return Promise.resolve();
        return new Promise((res) => this.waiters.push(res));
    }
    wake() {
        if (this.queue.length || this.running)
            return;
        const w = this.waiters;
        this.waiters = [];
        for (const f of w)
            f();
    }
    spawn() {
        let w;
        try {
            w = spawnModuleWorker(new URL('./texture-worker.js', import.meta.url));
        }
        catch {
            this.fail();
            return;
        }
        let answered = false;
        w.onmessage = (e) => {
            answered = true;
            const r = e.data;
            this.running--;
            this.stats.ms += r.ms ?? 0;
            this.stats.jobs++;
            if (r.ok && r.out && !this.taken.has(r.key))
                this.done.set(r.key, r.out);
            this.idle.push(w);
            this.pump();
            this.wake();
        };
        w.onerror = (ev) => {
            ev.preventDefault?.();
            // a direct module worker that never loaded (opaque-origin frame): retry once through the bootstrap
            if (!answered && !this.retried && reportWorkerLoadFailure()) {
                this.retried = true;
                this.restart();
                return;
            }
            this.fail();
        };
        this.workers.push(w);
        this.idle.push(w);
    }
    restart() {
        const n = this.workers.length;
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.idle = [];
        this.running = 0;
        // the jobs in flight are lost: they will be generated on the main thread if nobody re-queues them
        for (let i = 0; i < n; i++)
            this.spawn();
        this.pump();
        this.wake();
    }
    fail() {
        this.broken = true;
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.idle = [];
        this.queue.length = 0;
        this.running = 0;
        this.wake();
    }
    pump() {
        while (this.idle.length && this.queue.length) {
            const w = this.idle.shift();
            const job = this.queue.shift();
            this.running++;
            w.postMessage({ key: job.key, fn: job.call[0], args: job.call[1] });
        }
    }
}
export const texturePool = new TexturePool();
