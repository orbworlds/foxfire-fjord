/**
 * Camera-centred chunk layers for near blade clumps and far tufts.
 *
 * Each chunk draws one instanced mesh. Its instances come from a deterministic
 * candidate sequence (see place.ts): candidate k has rank k / nFull and the
 * shader shows it while rank < F(distance). A chunk is split into sub-cells,
 * each with its own rank target from its nearest point, so only candidates
 * that can actually be seen get evaluated. Builds run as resumable passes over
 * the sequence inside a per-frame time budget; GPU buffers ("slots") are
 * recycled between chunks and uploads are partial.
 */
import * as THREE from 'three';
import type { World } from '../../world/world';
import { smoothstep } from '../../world/noise';
import { STRIDE } from './config';
import { RuleGridBuilder, type GroundRules, type RuleGrid } from './ground';
import {
  LYME_SHARE,
  LYME_SHARE_TUFT,
  SALT_BLADE,
  SALT_TUFT,
  beginCandidate,
  evalBlade,
  evalTuft,
  sequenceSeed,
  type CandidateSource,
  type PlaceEnv,
} from './place';

export interface LayerSpec {
  name: string;
  /** chunk edge (m) */
  size: number;
  /** sub-cells per chunk side (independent build targets) */
  sub: number;
  /** spacing of the coarse rule grid (m) */
  gridStep: number;
  tuft: boolean;
  material: THREE.Material;
  /** template geometry per LOD level (LOD0 first) */
  templates: THREE.BufferGeometry[];
  layerSeed: number;
  /** only chunks touching this circle are considered (a small, always-detailed patch) */
  region?: { x: number; z: number; r: number };
}

export interface LayerParams {
  /** instances / m² where the coarse density is 1 */
  density: number;
  /** full density within r0, then (r0 / d)^pow */
  r0: number;
  pow: number;
  /** thicken in by rank across [fadeInStart, fadeInEnd] (far tufts) */
  fadeInStart: number;
  fadeInEnd: number;
  /** thin out by rank across [fadeOutStart, fadeOutEnd] (near blades) */
  fadeOutStart: number;
  fadeOutEnd: number;
  /** a chunk is active while its nearest point is closer than maxDist … */
  maxDist: number;
  /** … and its farthest point is farther than minDist */
  minDist: number;
  /** switch to the next template beyond this nearest-point distance */
  lodDist: number;
  /** height lattice spacing (m) */
  heightStep: number;
}

interface Slot {
  cap: number;
  data: Float32Array;
  buffer: THREE.InstancedInterleavedBuffer;
  geos: THREE.InstancedBufferGeometry[];
  mesh: THREE.Mesh;
}

const EMPTY = new Float32Array(0);
const LATTICE_MARGIN = 1.5;
/** build a little beyond what is visible so small camera moves need no work */
const DIST_MARGIN = 2.5;

class Chunk implements CandidateSource {
  readonly size: number;
  readonly x0: number;
  readonly z0: number;
  minY: number;
  maxY: number;
  grid!: RuleGrid;
  hasGrid = false;
  /** the rule grid while it is being built across frames */
  gridJob: RuleGridBuilder | null = null;
  peak = 0;
  /** mean acceptance of the coarse rules (capacity estimates) */
  accept = 0;
  nFull = 0;
  offU: number;
  offV: number;
  jit = 0;
  hseed: number;
  hgt = EMPTY;
  hx0 = 0;
  hz0 = 0;
  hs = 1;
  hN = 0;
  /** lattice rows filled so far (heights are built in resumable slices) */
  hRows = 0;
  /** per sub-cell rank wanted / rank already evaluated */
  readonly subTarget: Float32Array;
  readonly subBuilt: Float32Array;
  /** targets frozen for the running pass */
  readonly passT: Float32Array;
  passOn = false;
  passK = 0;
  passEnd = 0;
  needs = false;
  /** built well beyond the current targets: compact the buffer */
  shrink = false;
  count = 0;
  dirtyFrom = -1;
  slot: Slot | null = null;
  lod = 0;
  dMin = 0;
  prio = 0;
  active = false;
  lastActive = 0;

  constructor(
    readonly key: number,
    readonly cx: number,
    readonly cz: number,
    size: number,
    sub: number,
    world: World,
    layerSeed: number,
  ) {
    this.size = size;
    this.x0 = cx * size;
    this.z0 = cz * size;
    const s = sequenceSeed(cx, cz, layerSeed);
    this.offU = s.offU;
    this.offV = s.offV;
    this.hseed = s.hseed;
    this.subTarget = new Float32Array(sub * sub);
    this.subBuilt = new Float32Array(sub * sub);
    this.passT = new Float32Array(sub * sub);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j <= 2; j++) {
      for (let i = 0; i <= 2; i++) {
        const h = world.heightAtFast(this.x0 + i * size * 0.5, this.z0 + j * size * 0.5);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    this.minY = lo - 3;
    this.maxY = hi + 3;
  }

  resetInstances(): void {
    this.subBuilt.fill(0);
    this.passOn = false;
    this.count = 0;
    this.dirtyFrom = -1;
  }
}

const _sphere = new THREE.Sphere();
const _center = new THREE.Vector3();

export interface LayerStats {
  chunks: number;
  meshes: number;
  instances: number;
  pending: number;
}

export class ChunkLayer {
  readonly group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private active: Chunk[] = [];
  private prevActive: Chunk[] = [];
  private queue: Chunk[] = [];
  private free: Slot[] = [];
  private slotsInUse = 0;
  private lastCam = new THREE.Vector3(Infinity, Infinity, Infinity);
  private frame = 0;
  private env: PlaceEnv;
  private evaluate: typeof evalBlade;
  private salt: number;
  private share: number;

  constructor(
    private spec: LayerSpec,
    private world: World,
    rules: GroundRules,
    private params: LayerParams,
  ) {
    this.group.name = spec.name;
    this.env = { world, rules };
    this.evaluate = spec.tuft ? evalTuft : evalBlade;
    this.salt = spec.tuft ? SALT_TUFT : SALT_BLADE;
    this.share = spec.tuft ? LYME_SHARE_TUFT : LYME_SHARE;
  }

  /** New density / distances: keep the rule grids, rebuild instances. */
  setParams(p: LayerParams): void {
    const relattice = p.heightStep !== this.params.heightStep;
    this.params = p;
    for (const c of this.chunks.values()) {
      c.resetInstances();
      if (relattice) {
        c.hRows = 0;
        c.hN = 0;
      }
      if (c.hasGrid) this.sizeSequence(c);
      if (c.slot) c.slot.mesh.visible = false;
    }
    this.lastCam.set(Infinity, Infinity, Infinity);
  }

  /**
   * Per frame: refresh the active set when the camera moved, then extend the
   * chunks that need it until `deadline` (performance.now()).
   */
  update(cam: THREE.Vector3, frustum: THREE.Frustum, deadline: number, frustumOnly = false): void {
    this.frame++;
    if (cam.distanceToSquared(this.lastCam) > 2.25) {
      this.lastCam.copy(cam);
      this.refresh(cam);
    }
    this.build(frustum, deadline, frustumOnly);
    this.flush();
  }

  stats(): LayerStats {
    let instances = 0;
    let pending = 0;
    let meshes = 0;
    for (const c of this.active) {
      instances += c.count;
      if (c.slot && c.slot.mesh.visible) meshes++;
      if (this.needsWork(c)) pending++;
    }
    return { chunks: this.active.length, meshes, instances, pending };
  }

  /** Draw calls and triangles (as three.js counts them) this layer submits for a frustum. */
  drawStats(frustum: THREE.Frustum): { calls: number; triangles: number } {
    let calls = 0;
    let triangles = 0;
    for (const c of this.active) {
      const s = c.slot;
      if (!s || !s.mesh.visible) continue;
      const g = s.mesh.geometry as THREE.InstancedBufferGeometry;
      if (g.instanceCount === 0) continue;
      _sphere.copy(g.boundingSphere!).applyMatrix4(s.mesh.matrixWorld);
      if (!frustum.intersectsSphere(_sphere)) continue;
      calls++;
      triangles += (g.index!.count / 3) * g.instanceCount;
    }
    return { calls, triangles };
  }

  dispose(): void {
    for (const c of this.chunks.values()) if (c.slot) this.destroySlot(c.slot);
    for (const s of this.free) this.destroySlot(s);
    this.chunks.clear();
    this.free.length = 0;
    this.active.length = 0;
  }

  /* -------------------------------------------------------------- */

  private needsWork(c: Chunk): boolean {
    if (!c.hasGrid) return true;
    if (c.peak <= 0 || c.nFull === 0) return false;
    return c.hN === 0 || c.hRows < c.hN || c.passOn || c.needs;
  }

  private refresh(cam: THREE.Vector3): void {
    const { size } = this.spec;
    const p = this.params;
    const R = p.maxDist;
    const prev = this.prevActive;
    prev.length = 0;
    for (const c of this.active) {
      c.active = false;
      prev.push(c);
    }
    const list = this.active;
    list.length = 0;
    const i0 = Math.floor((cam.x - R) / size);
    const i1 = Math.floor((cam.x + R) / size);
    const j0 = Math.floor((cam.z - R) / size);
    const j1 = Math.floor((cam.z + R) / size);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x0 = i * size;
        const z0 = j * size;
        const rg = this.spec.region;
        if (rg) {
          const qx = Math.max(x0, Math.min(rg.x, x0 + size)) - rg.x;
          const qz = Math.max(z0, Math.min(rg.z, z0 + size)) - rg.z;
          if (qx * qx + qz * qz > rg.r * rg.r) continue;
        }
        const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - size);
        const dz = Math.max(z0 - cam.z, 0, cam.z - z0 - size);
        const dxz2 = dx * dx + dz * dz;
        if (dxz2 > R * R) continue;
        const key = (i + 32768) * 65536 + (j + 32768);
        let c = this.chunks.get(key);
        if (!c) {
          c = new Chunk(key, i, j, size, this.spec.sub, this.world, this.spec.layerSeed);
          this.chunks.set(key, c);
        }
        if (c.hasGrid && c.peak <= 0) continue;
        const dy = Math.max(0, c.minY - cam.y, cam.y - c.maxY);
        const dMin = Math.sqrt(dxz2 + dy * dy);
        if (dMin > R) continue;
        const fx = Math.max(Math.abs(cam.x - x0), Math.abs(cam.x - x0 - size));
        const fz = Math.max(Math.abs(cam.z - z0), Math.abs(cam.z - z0 - size));
        const fy = Math.max(Math.abs(cam.y - c.minY), Math.abs(cam.y - c.maxY));
        if (fx * fx + fz * fz + fy * fy < p.minDist * p.minDist) continue;
        c.dMin = dMin;
        c.active = true;
        c.lastActive = this.frame;
        list.push(c);
        this.targets(c, cam);
        if (this.spec.templates.length > 1) {
          const want = dMin > p.lodDist + (c.lod ? -1.5 : 1.5) ? 1 : 0;
          if (want !== c.lod) {
            c.lod = want;
            if (c.slot) c.slot.mesh.geometry = c.slot.geos[want];
          }
        }
      }
    }
    for (const c of prev) {
      if (!c.active && c.slot) c.slot.mesh.visible = false;
    }
    this.evict();
  }

  /** Rank each sub-cell can show at its nearest (and, for fade-in, farthest) point. */
  private targets(c: Chunk, cam: THREE.Vector3): void {
    const p = this.params;
    const n = this.spec.sub;
    const cs = c.size / n;
    const dyMin = Math.max(0, c.minY - cam.y, cam.y - c.maxY);
    const dyMax = Math.max(Math.abs(cam.y - c.minY), Math.abs(cam.y - c.maxY));
    let needs = false;
    let builtSum = 0;
    let surplus = 0;
    for (let j = 0; j < n; j++) {
      const z0 = c.z0 + j * cs;
      const dz = Math.max(z0 - cam.z, 0, cam.z - z0 - cs);
      const fz = Math.max(Math.abs(cam.z - z0), Math.abs(cam.z - z0 - cs));
      for (let i = 0; i < n; i++) {
        const x0 = c.x0 + i * cs;
        const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - cs);
        const fx = Math.max(Math.abs(cam.x - x0), Math.abs(cam.x - x0 - cs));
        const dMin = Math.max(0.5, Math.sqrt(dx * dx + dz * dz + dyMin * dyMin) - DIST_MARGIN);
        const dMax = Math.sqrt(fx * fx + fz * fz + dyMax * dyMax) + DIST_MARGIN;
        let f = Math.min(1, Math.pow(p.r0 / dMin, p.pow));
        if (p.fadeOutEnd < Infinity) f *= 1 - smoothstep(p.fadeOutStart, p.fadeOutEnd, dMin);
        if (p.fadeInEnd > 0) f *= smoothstep(p.fadeInStart, p.fadeInEnd, dMax);
        const k = j * n + i;
        c.subTarget[k] = f;
        if (f > c.subBuilt[k] + 1e-6) needs = true;
        builtSum += c.subBuilt[k];
        surplus += Math.max(0, c.subBuilt[k] - f);
      }
    }
    c.needs = needs;
    // the shader hides what lies beyond the targets, but it still costs vertices
    c.shrink = c.count > 384 && surplus > 0.3 * builtSum;
  }

  /** Release the buffers of chunks that have been out of range the longest. */
  private evict(): void {
    const keep = this.active.length + (this.spec.tuft ? 10 : 18);
    if (this.slotsInUse > keep) {
      const idle: Chunk[] = [];
      for (const c of this.chunks.values()) if (!c.active && c.slot) idle.push(c);
      idle.sort((a, b) => a.lastActive - b.lastActive);
      for (const c of idle) {
        if (this.slotsInUse <= keep) break;
        this.releaseSlot(c);
      }
    }
    if (this.chunks.size > 900) {
      for (const [key, c] of this.chunks) {
        if (!c.active && !c.slot && this.frame - c.lastActive > 600) this.chunks.delete(key);
      }
    }
  }

  /** Advance the chunk's rule grid; true once it is complete and the sequence is sized. */
  private prepare(c: Chunk, deadline: number): boolean {
    if (!c.gridJob) c.gridJob = new RuleGridBuilder(this.env.rules, c.x0, c.z0, c.size, this.spec.gridStep);
    if (!c.gridJob.step(deadline)) return false;
    const g = c.gridJob.grid;
    c.gridJob = null;
    c.grid = g;
    c.hasGrid = true;
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < g.density.length; i++) {
      const v = g.density[i] + this.share * g.lyme[i];
      sum += v;
      if (v > peak) peak = v;
    }
    c.peak = peak;
    c.accept = peak > 0 ? sum / g.density.length / peak : 0;
    c.minY = g.minY - 0.1;
    c.maxY = g.maxY + 1.2;
    this.sizeSequence(c);
    return true;
  }

  private sizeSequence(c: Chunk): void {
    c.nFull = Math.max(0, Math.round(c.size * c.size * this.params.density * c.peak));
    // about one point spacing of jitter: the bare R2 lattice reads as rows
    c.jit = c.nFull > 0 ? 0.95 / Math.sqrt(c.nFull) : 0;
  }

  private chunkSphere(c: Chunk, out: THREE.Sphere): THREE.Sphere {
    const h = c.size * 0.5;
    const hy = (c.maxY - c.minY) * 0.5;
    out.center.set(c.x0 + h, (c.minY + c.maxY) * 0.5, c.z0 + h);
    out.radius = Math.sqrt(2 * h * h + hy * hy) + 1;
    return out;
  }

  private build(frustum: THREE.Frustum, deadline: number, frustumOnly: boolean): void {
    for (const c of this.active) {
      if (!c.shrink || c.passOn || !c.slot) continue;
      if (performance.now() > deadline) break;
      this.compact(c);
    }
    const q = this.queue;
    q.length = 0;
    for (const c of this.active) {
      if (!this.needsWork(c)) continue;
      const inView = frustum.intersectsSphere(this.chunkSphere(c, _sphere));
      if (frustumOnly && !inView) continue;
      c.prio = c.dMin + (inView ? 0 : 1000);
      q.push(c);
    }
    if (!q.length) return;
    q.sort((a, b) => a.prio - b.prio);
    for (const c of q) {
      if (performance.now() > deadline) break;
      if (!c.hasGrid) {
        if (!this.prepare(c, deadline)) break;
        if (c.peak <= 0 || c.nFull === 0) {
          c.active = false;
          c.needs = false;
          continue;
        }
      }
      if (c.hN === 0 || c.hRows < c.hN) {
        if (!this.lattice(c, deadline)) break;
      }
      this.fill(c, deadline);
    }
  }

  /** Fill the chunk's height lattice row by row; false if the deadline hit first. */
  private lattice(c: Chunk, deadline: number): boolean {
    if (c.hN === 0) {
      const hs = this.params.heightStep;
      c.hs = hs;
      c.hx0 = Math.floor((c.x0 - LATTICE_MARGIN) / hs) * hs;
      c.hz0 = Math.floor((c.z0 - LATTICE_MARGIN) / hs) * hs;
      c.hN = Math.ceil((c.x0 + c.size + LATTICE_MARGIN - c.hx0) / hs) + 1;
      c.hRows = 0;
      if (c.hgt.length < c.hN * c.hN) c.hgt = new Float32Array(c.hN * c.hN);
    }
    const n = c.hN;
    const world = this.world;
    while (c.hRows < n) {
      if (performance.now() > deadline) return false;
      const j = c.hRows;
      const z = c.hz0 + j * c.hs;
      for (let i = 0; i < n; i++) c.hgt[j * n + i] = world.heightAt(c.hx0 + i * c.hs, z);
      c.hRows++;
    }
    return true;
  }

  /** Run (or resume) a pass over the candidate sequence for the frozen sub-cell targets. */
  private fill(c: Chunk, deadline: number): void {
    const sub = this.spec.sub;
    const cells = sub * sub;
    if (!c.passOn) {
      if (!c.needs) return;
      let lo = 1;
      let hi = 0;
      let expect = 0;
      for (let s = 0; s < cells; s++) {
        const t = c.subTarget[s];
        c.passT[s] = t;
        if (t > c.subBuilt[s]) {
          lo = Math.min(lo, c.subBuilt[s]);
          hi = Math.max(hi, t);
          expect += t - c.subBuilt[s];
        }
      }
      c.needs = false;
      if (hi <= lo) return;
      c.passOn = true;
      c.passK = Math.floor(lo * c.nFull);
      c.passEnd = Math.min(c.nFull, Math.ceil(hi * c.nFull));
      const est = c.count + Math.ceil((expect / cells) * c.nFull * c.accept * 1.15) + 48;
      if (!c.slot || c.slot.cap < est) this.grow(c, est);
    }
    let slot = c.slot!;
    let data = slot.data;
    let n = c.count;
    const start = n;
    let k = c.passK;
    const end = c.passEnd;
    const inv = 1 / c.nFull;
    const env = this.env;
    const evaluate = this.evaluate;
    const salt = this.salt;
    const built = c.subBuilt;
    const want = c.passT;
    while (k < end) {
      if ((k & 31) === 0 && performance.now() > deadline) break;
      const s = beginCandidate(c, k, salt, sub);
      const r = k * inv;
      if (r >= built[s] && r < want[s]) {
        if (n >= slot.cap) {
          c.count = n;
          this.grow(c, Math.ceil(n * 1.5) + 64);
          slot = c.slot!;
          data = slot.data;
        }
        if (evaluate(env, c, k, data, n * STRIDE)) n++;
      }
      k++;
    }
    c.passK = k;
    c.count = n;
    if (n > start) c.dirtyFrom = c.dirtyFrom < 0 ? start : Math.min(c.dirtyFrom, start);
    if (k >= end) {
      c.passOn = false;
      for (let s = 0; s < cells; s++) if (want[s] > built[s]) built[s] = want[s];
      for (let s = 0; s < cells; s++) if (c.subTarget[s] > built[s] + 1e-6) c.needs = true;
    }
  }

  /** Drop the instances the current targets no longer show: one pass over the buffer, no re-evaluation. */
  private compact(c: Chunk): void {
    c.shrink = false;
    const sub = this.spec.sub;
    const data = c.slot!.data;
    const want = c.subTarget;
    const nFull = c.nFull;
    const inv = 1 / nFull;
    let w = 0;
    let first = -1;
    for (let i = 0; i < c.count; i++) {
      const o = i * STRIDE;
      const k = Math.round(data[o + 3] * nFull);
      if (k * inv >= want[beginCandidate(c, k, this.salt, sub)]) {
        if (first < 0) first = w;
        continue;
      }
      if (w !== i) data.copyWithin(w * STRIDE, o, o + STRIDE);
      w++;
    }
    if (first >= 0) {
      c.dirtyFrom = c.dirtyFrom < 0 ? first : Math.min(c.dirtyFrom, first);
      c.count = w;
    }
    const built = c.subBuilt;
    for (let s = 0; s < built.length; s++) if (built[s] > want[s]) built[s] = want[s];
  }

  /* -------------------------------------------------------------- */
  /* Slots                                                           */
  /* -------------------------------------------------------------- */

  private grow(c: Chunk, need: number): void {
    const cap = Math.max(256, 1 << Math.ceil(Math.log2(need)));
    const old = c.slot;
    const slot = this.takeSlot(cap);
    if (old && c.count > 0) slot.data.set(old.data.subarray(0, c.count * STRIDE));
    c.slot = slot;
    c.dirtyFrom = c.count > 0 ? 0 : -1;
    if (old) this.giveBack(old);
    const s = this.chunkSphere(c, _sphere);
    const h = c.size * 0.5;
    _center.set(h, s.center.y, h);
    for (const g of slot.geos) {
      g.boundingSphere!.set(_center, s.radius);
      g.instanceCount = 0;
    }
    slot.mesh.geometry = slot.geos[Math.min(c.lod, slot.geos.length - 1)];
    slot.mesh.position.set(c.x0, 0, c.z0);
    slot.mesh.updateMatrix();
    slot.mesh.visible = false;
  }

  private takeSlot(cap: number): Slot {
    let best = -1;
    for (let i = 0; i < this.free.length; i++) {
      const s = this.free[i];
      if (s.cap >= cap && s.cap <= cap * 4 && (best < 0 || s.cap < this.free[best].cap)) best = i;
    }
    this.slotsInUse++;
    if (best >= 0) return this.free.splice(best, 1)[0];
    return this.makeSlot(cap);
  }

  private giveBack(s: Slot): void {
    this.slotsInUse--;
    s.mesh.visible = false;
    for (const g of s.geos) g.instanceCount = 0;
    this.free.push(s);
    if (this.free.length > 10) {
      this.free.sort((a, b) => b.cap - a.cap);
      this.destroySlot(this.free.pop()!);
    }
  }

  private releaseSlot(c: Chunk): void {
    if (!c.slot) return;
    this.giveBack(c.slot);
    c.slot = null;
    c.resetInstances();
  }

  private makeSlot(cap: number): Slot {
    const data = new Float32Array(cap * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const iRoot = new THREE.InterleavedBufferAttribute(buffer, 4, 0);
    const iShape = new THREE.InterleavedBufferAttribute(buffer, 4, 4);
    const iTint = new THREE.InterleavedBufferAttribute(buffer, 4, 8);
    // each geometry owns copies of the template attributes: disposing a geometry
    // frees every attribute it references, so nothing may be shared across slots
    const geos = this.spec.templates.map((t) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(t.index!.clone());
      g.setAttribute('position', t.getAttribute('position').clone());
      g.setAttribute('normal', t.getAttribute('normal').clone());
      g.setAttribute('iRoot', iRoot);
      g.setAttribute('iShape', iShape);
      g.setAttribute('iTint', iTint);
      g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere();
      g.boundingBox = new THREE.Box3();
      return g;
    });
    const mesh = new THREE.Mesh(geos[0], this.spec.material);
    mesh.name = this.spec.name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.raycast = () => {};
    mesh.userData.noPick = true;
    mesh.userData.noMerge = true;
    this.group.add(mesh);
    return { cap, data, buffer, geos, mesh };
  }

  private destroySlot(s: Slot): void {
    this.group.remove(s.mesh);
    for (const g of s.geos) g.dispose();
  }

  /** Push written ranges to the GPU and sync draw counts / visibility. */
  private flush(): void {
    for (const c of this.active) {
      const s = c.slot;
      if (!s) continue;
      if (c.dirtyFrom >= 0 && c.count > c.dirtyFrom) {
        s.buffer.addUpdateRange(c.dirtyFrom * STRIDE, (c.count - c.dirtyFrom) * STRIDE);
        s.buffer.needsUpdate = true;
      }
      c.dirtyFrom = -1;
      for (const g of s.geos) g.instanceCount = c.count;
      s.mesh.visible = c.active && c.count > 0;
    }
  }
}
