/**
 * Runtime world services shared by all features:
 *   - exact terrain queries (heightAt, normalAt, slopeAt, coastDistance)
 *   - a baked height grid (CPU Float32Array + GPU half-float texture) over WORLD_BOUNDS,
 *     computed by module workers (also inside opaque-origin frames, see spawn-worker.ts)
 *   - ground masks (paths, plowed / cleared snow, structures) as CPU-sampleable data + GPU textures
 *   - a reservation registry so trees and scattered rocks never grow through buildings or paths
 */
import * as THREE from 'three';
import {
  heightAt,
  normalAt,
  slopeAt,
  coastDistance,
  pathCarve,
  WORLD_BOUNDS,
  sampleHeightGrid,
} from './terrain-height';
import { HOUSE, HOUSE_FOOTPRINT, PATHS, SITES, SPRING, SUMMIT, ICE_HUT, type Box2 } from './layout';
import { samplePath } from './paths';
import { reportWorkerLoadFailure, spawnModuleWorker } from './spawn-worker';
import type { QualitySettings } from '../core/quality';

/** High-resolution ground mask window around the cabin knoll (world). */
export const LOCAL_BOUNDS = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };

export type Reservation =
  | { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number; tag?: string }
  | { kind: 'circle'; x: number; z: number; r: number; tag?: string };

const RES_CELL = 16;

export class GroundMasks {
  /** RGBA over LOCAL_BOUNDS. R = path (packed snow), G = plowed / cleared snow, B = structure; A is unused (always opaque) */
  readonly localCanvas: HTMLCanvasElement;
  readonly localTexture: THREE.CanvasTexture;
  /** RG8 over WORLD_BOUNDS: R = trails and paths island-wide, G = plowed road */
  readonly trailTexture: THREE.DataTexture;
  private localData: Uint8ClampedArray;
  private trailData: Uint8Array;
  readonly localSize: number;
  readonly trailW: number;
  readonly trailH: number;

  constructor(quality: QualitySettings) {
    this.localSize = quality.textureSize >= 1024 ? 2048 : 1024;
    this.localCanvas = document.createElement('canvas');
    this.localCanvas.width = this.localCanvas.height = this.localSize;
    const ctx = this.localCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.localSize, this.localSize);
    this.drawDefaultLocal(ctx);
    this.localData = ctx.getImageData(0, 0, this.localSize, this.localSize).data;
    this.localTexture = new THREE.CanvasTexture(this.localCanvas);
    this.localTexture.colorSpace = THREE.NoColorSpace;
    this.localTexture.wrapS = this.localTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.localTexture.generateMipmaps = true;
    this.localTexture.minFilter = THREE.LinearMipmapLinearFilter;

    this.trailW = quality.textureSize >= 1024 ? 2048 : 1024;
    this.trailH = Math.round((this.trailW * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX));
    const ic = document.createElement('canvas');
    ic.width = this.trailW;
    ic.height = this.trailH;
    const ictx = ic.getContext('2d', { willReadFrequently: true })!;
    ictx.fillStyle = '#000';
    ictx.fillRect(0, 0, ic.width, ic.height);
    this.drawTrails(ictx);
    const rgba = ictx.getImageData(0, 0, ic.width, ic.height).data;
    this.trailData = new Uint8Array(ic.width * ic.height * 2);
    for (let i = 0, n = ic.width * ic.height; i < n; i++) {
      this.trailData[i * 2] = rgba[i * 4];
      this.trailData[i * 2 + 1] = rgba[i * 4 + 1];
    }
    this.trailTexture = new THREE.DataTexture(this.trailData, ic.width, ic.height, THREE.RGFormat, THREE.UnsignedByteType);
    this.trailTexture.wrapS = this.trailTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.trailTexture.magFilter = THREE.LinearFilter;
    this.trailTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.trailTexture.generateMipmaps = true;
    this.trailTexture.needsUpdate = true;
  }

  /** world → local mask canvas pixel */
  toLocal(x: number, z: number): [number, number] {
    const b = LOCAL_BOUNDS;
    return [((x - b.minX) / (b.maxX - b.minX)) * this.localSize, ((z - b.minZ) / (b.maxZ - b.minZ)) * this.localSize];
  }

  /** meters → local mask pixels */
  localScale(m: number): number {
    return (m / (LOCAL_BOUNDS.maxX - LOCAL_BOUNDS.minX)) * this.localSize;
  }

  private drawDefaultLocal(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter';
    const rect = (b: Box2, color: string, pad = 0) => {
      const [x0, y0] = this.toLocal(b.minX - pad, b.minZ - pad);
      const [x1, y1] = this.toLocal(b.maxX + pad, b.maxZ + pad);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const local = (b: Box2): Box2 => ({ minX: HOUSE.x + b.minX, maxX: HOUSE.x + b.maxX, minZ: HOUSE.z + b.minZ, maxZ: HOUSE.z + b.maxZ });
    // structures: the cabin, the glass wing and the deck → blue channel
    rect(local(HOUSE.cabin), 'rgb(0,0,255)', 0.4);
    rect(local(HOUSE.wing), 'rgb(0,0,255)', 0.3);
    rect(local(HOUSE.deck), 'rgb(0,0,255)', 0.1);
    // shovelled snow: a cleared apron at the entry and round the fire pit → green channel
    const f = HOUSE.firePit;
    // trodden round the benches, feathering out into the untouched cover (no hard rim)
    const [fx, fy] = this.toLocal(HOUSE.x + f.x, HOUSE.z + f.z);
    const fr = this.localScale(f.r + 0.6);
    const fg = ctx.createRadialGradient(fx, fy, fr * 0.65, fx, fy, fr);
    fg.addColorStop(0, 'rgb(0,200,0)');
    fg.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.fill();
    rect(local({ minX: HOUSE.entryX - 1.6, maxX: HOUSE.entryX + 1.6, minZ: HOUSE.cabin.maxZ, maxZ: HOUSE.cabin.maxZ + 3 }), 'rgb(0,170,0)');
    // paths → red channel (plowed ones also green)
    for (const p of PATHS) {
      const s = samplePath(p, 1);
      ctx.strokeStyle = p.kind === 'plowed' ? 'rgb(255,255,0)' : 'rgb(255,0,0)';
      ctx.lineWidth = Math.max(1, this.localScale(p.width + 0.6));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.forEach((q, i) => {
        const [px, py] = this.toLocal(q.x, q.z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawTrails(ctx: CanvasRenderingContext2D) {
    const b = WORLD_BOUNDS;
    const sx = this.trailW / (b.maxX - b.minX);
    const sz = this.trailH / (b.maxZ - b.minZ);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of PATHS) {
      const s = samplePath(p, 2);
      ctx.strokeStyle = p.kind === 'plowed' ? '#ffff00' : '#ff0000';
      ctx.lineWidth = Math.max(1.2, (p.width + 0.8) * sx);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.forEach((q, i) => {
        const px = (q.x - b.minX) * sx;
        const py = (q.z - b.minZ) * sz;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Paint into the local mask (e.g. a shovelled yard as cleared snow). The
   * callback gets the 2D context plus helpers to convert world coordinates.
   * Call `commitLocal()` afterwards to upload and refresh CPU sampling.
   */
  paintLocal(fn: (ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], m2px: (m: number) => number) => void) {
    const ctx = this.localCanvas.getContext('2d', { willReadFrequently: true })!;
    fn(
      ctx,
      (x, z) => this.toLocal(x, z),
      (m) => this.localScale(m),
    );
  }

  commitLocal() {
    const ctx = this.localCanvas.getContext('2d', { willReadFrequently: true })!;
    this.localData = ctx.getImageData(0, 0, this.localSize, this.localSize).data;
    this.localTexture.needsUpdate = true;
  }

  /** Local mask RGBA at a world position, each 0..1 (zeros outside LOCAL_BOUNDS). */
  sampleLocal(x: number, z: number, out: [number, number, number, number] = [0, 0, 0, 0]) {
    const [px, py] = this.toLocal(x, z);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= this.localSize || iy >= this.localSize) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return out;
    }
    const k = (iy * this.localSize + ix) * 4;
    out[0] = this.localData[k] / 255;
    out[1] = this.localData[k + 1] / 255;
    out[2] = this.localData[k + 2] / 255;
    out[3] = this.localData[k + 3] / 255;
    return out;
  }

  /** Island-wide path coverage 0..1 */
  sampleTrail(x: number, z: number): number {
    const b = WORLD_BOUNDS;
    const ix = Math.floor(((x - b.minX) / (b.maxX - b.minX)) * this.trailW);
    const iy = Math.floor(((z - b.minZ) / (b.maxZ - b.minZ)) * this.trailH);
    if (ix < 0 || iy < 0 || ix >= this.trailW || iy >= this.trailH) return 0;
    return this.trailData[(iy * this.trailW + ix) * 2] / 255;
  }
}

export class World {
  readonly bounds = WORLD_BOUNDS;
  readonly localBounds = LOCAL_BOUNDS;
  readonly heightAt = heightAt;
  readonly normalAt = normalAt;
  readonly slopeAt = slopeAt;
  readonly coastDistance = coastDistance;
  readonly pathCarve = pathCarve;

  /** baked heights over WORLD_BOUNDS, row-major (z rows), gridNX × gridNZ */
  heightGrid!: Float32Array;
  gridNX = 0;
  gridNZ = 0;
  /** half-float RED texture of heights over WORLD_BOUNDS (u = x, v = z) */
  heightTexture!: THREE.DataTexture;
  masks!: GroundMasks;

  private reservations: Reservation[] = [];
  private resGrid = new Map<number, number[]>();

  static async create(quality: QualitySettings, onProgress?: (f: number) => void): Promise<World> {
    const w = new World();
    const scale = quality.terrainDetail >= 1 ? 1 : quality.terrainDetail >= 0.75 ? 0.75 : 0.5;
    // ~3.75 m texels over WORLD_BOUNDS at full detail
    w.gridNX = Math.round(1088 * scale) + 1;
    w.gridNZ = Math.round(1280 * scale) + 1;
    w.heightGrid = await computeHeightGrid(w.gridNX, w.gridNZ, onProgress);
    w.heightTexture = makeHeightTexture(w.heightGrid, w.gridNX, w.gridNZ);
    w.masks = new GroundMasks(quality);
    w.reserveDefaults();
    return w;
  }

  /** Bilinear height from the baked grid (fast, ~3 m resolution). Use heightAt for exact values. */
  heightAtFast(x: number, z: number): number {
    const b = this.bounds;
    const fx = ((x - b.minX) / (b.maxX - b.minX)) * (this.gridNX - 1);
    const fz = ((z - b.minZ) / (b.maxZ - b.minZ)) * (this.gridNZ - 1);
    const ix = Math.max(0, Math.min(this.gridNX - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(this.gridNZ - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const tz = Math.max(0, Math.min(1, fz - iz));
    const g = this.heightGrid;
    const n = this.gridNX;
    const a = g[iz * n + ix];
    const c = g[iz * n + ix + 1];
    const d = g[(iz + 1) * n + ix];
    const e = g[(iz + 1) * n + ix + 1];
    return (a + (c - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
  }

  /** Reserve ground so vegetation and scattered props avoid it. */
  reserve(r: Reservation): void {
    const idx = this.reservations.length;
    this.reservations.push(r);
    const bb =
      r.kind === 'rect'
        ? { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }
        : { minX: r.x - r.r, maxX: r.x + r.r, minZ: r.z - r.r, maxZ: r.z + r.r };
    for (let cz = Math.floor(bb.minZ / RES_CELL); cz <= Math.floor(bb.maxZ / RES_CELL); cz++) {
      for (let cx = Math.floor(bb.minX / RES_CELL); cx <= Math.floor(bb.maxX / RES_CELL); cx++) {
        const key = cz * 100003 + cx;
        let list = this.resGrid.get(key);
        if (!list) this.resGrid.set(key, (list = []));
        list.push(idx);
      }
    }
  }

  /**
   * True if (x, z) lies on reserved ground: registered reservations, any path
   * walking surface, or a structure in the local mask. `pad` grows shapes.
   */
  isReserved(x: number, z: number, pad = 0): boolean {
    const key = Math.floor(z / RES_CELL) * 100003 + Math.floor(x / RES_CELL);
    const list = this.resGrid.get(key);
    if (list) {
      for (const i of list) {
        const r = this.reservations[i];
        if (r.kind === 'rect') {
          if (x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad) return true;
        } else if (Math.hypot(x - r.x, z - r.z) <= r.r + pad) return true;
      }
    }
    const pc = pathCarve(x, z);
    if (pc.core > 0.05) return true;
    return false;
  }

  private reserveDefaults() {
    const f = HOUSE_FOOTPRINT;
    this.reserve({ kind: 'rect', minX: HOUSE.x + f.minX - 1.5, maxX: HOUSE.x + f.maxX + 1.5, minZ: HOUSE.z + f.minZ - 1.5, maxZ: HOUSE.z + f.maxZ + 1.5, tag: 'cabin' });
    this.reserve({ kind: 'circle', x: HOUSE.x + HOUSE.firePit.x, z: HOUSE.z + HOUSE.firePit.z, r: HOUSE.firePit.r + 1.5, tag: 'fire pit' });
    this.reserve({ kind: 'rect', ...pick(SITES.spring), tag: 'spring' });
    this.reserve({ kind: 'circle', x: SPRING.x, z: SPRING.z, r: 14, tag: 'spring' });
    this.reserve({ kind: 'rect', ...pick(SITES.sauna), tag: 'sauna' });
    this.reserve({ kind: 'circle', x: ICE_HUT.x, z: ICE_HUT.z, r: 6, tag: 'ice hut' });
    this.reserve({ kind: 'rect', ...pick(SITES.quay), tag: 'quay' });
    this.reserve({ kind: 'circle', x: SUMMIT.x, z: SUMMIT.z, r: 9, tag: 'summit' });
  }
}

function pick(b: Box2): Box2 {
  return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
}

function makeHeightTexture(grid: Float32Array, nx: number, nz: number): THREE.DataTexture {
  const half = new Uint16Array(grid.length);
  for (let i = 0; i < grid.length; i++) half[i] = THREE.DataUtils.toHalfFloat(grid[i]);
  const tex = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

async function computeHeightGrid(nx: number, nz: number, onProgress?: (f: number) => void): Promise<Float32Array> {
  const b = WORLD_BOUNDS;
  const out = new Float32Array(nx * nz);
  const workers = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const chunk = Math.ceil(nz / (workers * 3));
  const total = Math.ceil(nz / chunk);
  const run = () =>
    new Promise<void>((resolve, reject) => {
      const jobs: { row0: number; row1: number }[] = [];
      for (let r = 0; r < nz; r += chunk) jobs.push({ row0: r, row1: Math.min(nz, r + chunk) });
      let done = 0;
      let answered = false;
      const pool: Worker[] = [];
      const next = (w: Worker) => {
        const job = jobs.shift();
        if (!job) return;
        w.postMessage({ minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ, nx, nz, ...job });
      };
      for (let i = 0; i < workers; i++) {
        const w = spawnModuleWorker(new URL('./height-worker.ts', import.meta.url));
        w.onmessage = (e: MessageEvent<{ row0: number; data: Float32Array }>) => {
          answered = true;
          out.set(e.data.data, e.data.row0 * nx);
          done++;
          onProgress?.(done / total);
          if (jobs.length) next(w);
          else if (done >= total) {
            pool.forEach((p) => p.terminate());
            resolve();
          }
        };
        w.onerror = (err) => {
          pool.forEach((p) => p.terminate());
          // a direct module worker that never loaded (opaque-origin frame): signal a retry via the bootstrap
          reject(!answered && reportWorkerLoadFailure() ? 'retry' : err);
        };
        pool.push(w);
        next(w);
      }
    });
  try {
    try {
      await run();
    } catch (err) {
      if (err !== 'retry') throw err;
      await run();
    }
    return out;
  } catch (err) {
    console.warn('[world] worker height bake failed, falling back to main thread', err);
    return sampleHeightGrid(b.minX, b.minZ, b.maxX, b.maxZ, nx, nz);
  }
}
