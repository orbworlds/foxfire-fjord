/**
 * Warm lamps that light the air: the cabin's windows, its door lantern and
 * fires, the lantern posts along the paths, the hot spring's torches and the
 * lake sauna's door lantern. Falling snow, diamond dust and mist near them
 * pick up their amber glow. The CPU keeps the eight nearest lamps to the
 * camera in a small uniform array (refreshed a few times a second); shaders
 * include LAMP_GLSL and call wxLamps(worldPos).
 */
import * as THREE from 'three';
import type { FeatureContext } from '../../core/types';
import { HOUSE, HOUSE_OPENINGS, houseToWorld, SAUNA } from '../../world/layout';
import { LANTERNS } from '../paths/layout';
import { TORCHES } from '../spring/layout';
import type { CabinApi } from '../house';

export const LAMP_COUNT = 8;

export const LAMP_GLSL = /* glsl */ `
#define WX_LAMPS ${LAMP_COUNT}
uniform vec4 uLampPos[WX_LAMPS];
uniform vec3 uLampCol[WX_LAMPS];
// irradiance of the nearest warm lamps at p (inverse square, softened at the source, faded at its reach)
vec3 wxLamps(vec3 p) {
  vec3 e = vec3(0.0);
  for (int i = 0; i < WX_LAMPS; i++) {
    vec3 d = uLampPos[i].xyz - p;
    float r2 = dot(d, d);
    float reach = uLampPos[i].w;
    e += uLampCol[i] * (1.0 - smoothstep(0.3, 1.0, r2 / (reach * reach))) / (r2 + 0.35);
  }
  return e;
}
`;

interface LampSpot {
  pos: THREE.Vector3;
  /** linear colour × power (irradiance at 1 m) */
  color: THREE.Color;
  reach: number;
  /** how lit it is right now, 0..1+ */
  level: () => number;
}

const WINDOW = new THREE.Color(1.0, 0.56, 0.24);
const FLAME = new THREE.Color(1.0, 0.48, 0.16);
const LANTERN = new THREE.Color(1.0, 0.6, 0.3);

export class LampSet {
  readonly uniforms = {
    uLampPos: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
    uLampCol: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Color(0, 0, 0)) },
  };
  private spots: LampSpot[] = [];
  private timer = 0;
  private order: number[] = [];

  constructor(private ctx: FeatureContext) {
    const { shared, world } = ctx;
    const night = () => THREE.MathUtils.smoothstep(shared.uNight.value, 0.1, 0.6);
    const cabin = () => ctx.getFeature<CabinApi>('house')?.api;
    const glow = (zone: 'living' | 'glasswing') => () => {
      if (!cabin()) return 0;
      try {
        return Math.min(1.3, ctx.materials.glowLevel(zone)) * (0.35 + 0.65 * night());
      } catch {
        return 0;
      }
    };
    // cabin windows: the light pours out about half a metre in front of the pane
    const C = HOUSE.cabin;
    for (const o of HOUSE_OPENINGS) {
      if (o.kind !== 'window' && o.kind !== 'glazedDoor') continue;
      const out = 0.55;
      let lx = o.c;
      let lz = 0;
      if (o.wall === 'north') lz = C.minZ - out;
      else if (o.wall === 'south') lz = C.maxZ + out;
      else if (o.wall === 'west') {
        lx = C.minX - out;
        lz = o.c;
      } else {
        lx = C.maxX + out;
        lz = o.c;
      }
      const [x, y, z] = houseToWorld(lx, (o.sill + o.head) / 2, lz);
      const area = o.w * (o.head - o.sill);
      this.add(x, y, z, WINDOW, 1.1 * area, 9, glow('living'));
    }
    // the glass wing glows through its gable and roof
    const Wg = HOUSE.wing;
    const wing = glow('glasswing');
    const blinds = () => cabin()?.getBlindsOpenness?.() ?? 1;
    const wingLevel = () => wing() * (0.45 + 0.55 * blinds());
    for (const [lx, ly, lz] of [
      [(Wg.minX + Wg.maxX) / 2, 1.6, Wg.minZ - 0.7],
      [Wg.minX - 0.6, 1.4, (Wg.minZ + Wg.maxZ) / 2],
      [Wg.maxX + 0.6, 1.4, (Wg.minZ + Wg.maxZ) / 2],
      [(Wg.minX + Wg.maxX) / 2, Wg.ridgeH + 0.8, (Wg.minZ + Wg.maxZ) / 2],
    ]) {
      const [x, y, z] = houseToWorld(lx, ly, lz);
      this.add(x, y, z, WINDOW, 1.6, 10, wingLevel);
    }
    // the storm lantern by the entry door and the deck's lantern string
    {
      const [x, y, z] = houseToWorld(HOUSE.entryX - 0.78, 2.02, C.maxZ + 0.35);
      this.add(x, y, z, LANTERN, 0.5, 7, night);
      const D = HOUSE.deck;
      const [dx, dy, dz] = houseToWorld((D.minX + D.maxX) / 2, 2.3, (D.minZ + D.maxZ) / 2);
      this.add(dx, dy, dz, LANTERN, 0.7, 9, night);
    }
    // the fire pit and the hot tub's stove
    {
      const P = HOUSE.firePit;
      const gy = world.heightAt(HOUSE.x + P.x, HOUSE.z + P.z);
      this.add(HOUSE.x + P.x, gy + 1.0, HOUSE.z + P.z, FLAME, 2.2, 12, () => night() * 0.9);
      const T = HOUSE.hotTub;
      const [tx, ty, tz] = houseToWorld(T.x - 1.3, 0.9, T.z - 0.6);
      this.add(tx, ty, tz, FLAME, 0.5, 6, night);
    }
    // lantern posts along the paths
    for (const l of LANTERNS) {
      const x = l.x + l.face[0] * 0.42;
      const z = l.z + l.face[1] * 0.42;
      this.add(x, world.heightAt(l.x, l.z) + 1.38, z, LANTERN, 0.45, 7, night);
    }
    // the hot spring's torches
    for (const [x, z] of TORCHES) this.add(x, world.heightAt(x, z) + 1.6, z, FLAME, 0.6, 8, night);
    // the lake sauna's door lantern
    this.add(SAUNA.x + 2.3, SAUNA.y + 2.1, SAUNA.z, LANTERN, 0.45, 7, night);
  }

  add(x: number, y: number, z: number, color: THREE.Color, power: number, reach: number, level: () => number): void {
    this.spots.push({ pos: new THREE.Vector3(x, y, z), color: color.clone().multiplyScalar(power), reach, level });
  }

  /** pick the nearest lamps to the camera (a few times a second) and write their current levels */
  update(dt: number, cam: THREE.Vector3, force = false): void {
    this.timer -= dt;
    if (this.timer <= 0 || force) {
      this.timer = 0.4;
      const d = this.spots.map((s, i) => [s.pos.distanceToSquared(cam), i]);
      d.sort((a, b) => a[0] - b[0]);
      this.order = d.slice(0, LAMP_COUNT).map((x) => x[1]);
    }
    const P = this.uniforms.uLampPos.value;
    const Cc = this.uniforms.uLampCol.value;
    for (let i = 0; i < LAMP_COUNT; i++) {
      const s = this.spots[this.order[i]];
      if (!s) {
        P[i].set(0, -1e4, 0, 1);
        Cc[i].setRGB(0, 0, 0);
        continue;
      }
      P[i].set(s.pos.x, s.pos.y, s.pos.z, s.reach);
      Cc[i].copy(s.color).multiplyScalar(Math.max(0, s.level()));
    }
  }
}
