/**
 * Trails of boot prints trodden into the snow on the ice and along the shore:
 * multiply-blended decals (a blue-grey cavity, soft edged) lying on the
 * ground, alternating left and right along a polyline. One mesh per call.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../world/noise';

let bootTex: THREE.Texture | null = null;

function bootTexture(): THREE.Texture {
  if (bootTex) return bootTex;
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const sole = (x: number, y: number, cy: number, ry: number, rx: number) => {
    const d = Math.hypot((x - W / 2) / rx, (y - cy) / ry);
    return 1 - Math.min(1, Math.max(0, (d - 0.72) / 0.38));
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = Math.max(sole(x, y, 42, 34, 22), sole(x, y, 101, 20, 18));
      // a crisp rim on the side the light comes from, the cavity blue
      const depth = 0.72 + 0.28 * Math.sin((y / H) * Math.PI);
      const o = (y * W + x) * 4;
      img.data[o] = Math.round(255 - k * 70 * depth);
      img.data[o + 1] = Math.round(255 - k * 55 * depth);
      img.data[o + 2] = Math.round(255 - k * 36 * depth);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  bootTex = new THREE.CanvasTexture(c);
  bootTex.colorSpace = THREE.SRGBColorSpace;
  return bootTex;
}

/** Boot prints along each polyline (world xz), lying on `ground(x, z)`. */
export function bootTrails(trails: [number, number][][], ground: (x: number, z: number) => number, seed = 5): THREE.Mesh {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const stride = 0.38;
  for (const tr of trails) {
    let left = true;
    for (let i = 0; i < tr.length - 1; i++) {
      const [ax, az] = tr[i];
      const [bx, bz] = tr[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      for (let s = rnd() * stride; s < len; s += stride * (0.9 + rnd() * 0.2)) {
        const side = left ? -1 : 1;
        left = !left;
        const wob = (rnd() - 0.5) * 0.3 + side * 0.08;
        const fx = dx * Math.cos(wob) - dz * Math.sin(wob);
        const fz = dz * Math.cos(wob) + dx * Math.sin(wob);
        const cx = ax + dx * s - dz * side * 0.12;
        const cz = az + dz * s + dx * side * 0.12;
        const hw = 0.065;
        const hl = 0.16;
        const base = pos.length / 3;
        for (const [u, v] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const px = cx + -fz * u * hw + fx * v * hl;
          const pz = cz + fx * u * hw + fz * v * hl;
          pos.push(px, ground(px, pz) + 0.025, pz);
          uv.push((u + 1) / 2, (v + 1) / 2);
        }
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  if (nrm.count && nrm.getY(0) < 0) {
    const ix = g.index!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    name: 'bootPrints',
    map: bootTexture(),
    blending: THREE.MultiplyBlending,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    fog: false,
  });
  mat.userData.snow = 0;
  const m = new THREE.Mesh(g, mat);
  m.name = 'boot-prints';
  m.renderOrder = 1;
  m.raycast = () => {};
  m.userData.snow = 0;
  m.userData.shelter = false;
  return m;
}
