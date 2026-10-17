/**
 * The fox's poses and gaits, procedural: every pose is a set of joint angles
 * (pitch about x, yaw about y, roll about z, radians, relative to the rest
 * pose) plus a lift of the body; poses blend by weights and the result is
 * written into the bones. Conventions (fox space, +z forward): positive pitch
 * tips a bone's forward end down, and swings a hanging leg backward.
 *
 *   stand    weight on four feet, breathing, the brush hanging low
 *   trot     the fox's travelling gait: diagonal pairs (left fore with right
 *            hind) swing together, the body bobs twice a stride, the head
 *            stays level and the brush streams out behind
 *   sniff    nose down to the snow, ears forward, the brush swaying
 *   sit      on its haunches, forelegs straight, head up (to the aurora), the
 *            brush curled round the front paws
 *   pounce   the mousing leap: crouch, spring high, dive nose-first into
 *            the snow, stay head-down a moment, pop out
 */
import * as THREE from 'three';
import { B, BONES } from './body';

const NB = BONES.length;

export class Pose {
  /** euler angles per bone: x pitch, y yaw, z roll */
  readonly a = new Float32Array(NB * 3);
  /** body lift (m, applied to the hips) and forward shift */
  lift = 0;
  shift = 0;

  clear(): this {
    this.a.fill(0);
    this.lift = 0;
    this.shift = 0;
    return this;
  }
  set(b: number, x: number, y = 0, z = 0): this {
    this.a[b * 3] = x;
    this.a[b * 3 + 1] = y;
    this.a[b * 3 + 2] = z;
    return this;
  }
  add(b: number, x: number, y = 0, z = 0): this {
    this.a[b * 3] += x;
    this.a[b * 3 + 1] += y;
    this.a[b * 3 + 2] += z;
    return this;
  }
  /** this += other * w */
  accumulate(o: Pose, w: number): this {
    for (let i = 0; i < this.a.length; i++) this.a[i] += o.a[i] * w;
    this.lift += o.lift * w;
    this.shift += o.shift * w;
    return this;
  }
}

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Head and ear touches shared by all poses: look (yaw, pitch) and ear twitches. */
function headLook(p: Pose, yaw: number, pitch: number, t: number, alert = 0.5): void {
  p.add(B.neck, pitch * 0.45, yaw * 0.45);
  p.add(B.head, pitch * 0.55, yaw * 0.55);
  // ears: pricked forward when alert, an occasional flick
  const flickL = Math.max(0, Math.sin(t * 0.9 + 1.3)) ** 30 * 0.5;
  const flickR = Math.max(0, Math.sin(t * 0.77 + 4.1)) ** 30 * 0.5;
  p.add(B.earL, -0.1 * alert - flickL * 0.6, 0, 0.12 - flickL);
  p.add(B.earR, -0.1 * alert - flickR * 0.6, 0, -0.12 + flickR);
}

/** Standing. */
export function poseStand(p: Pose, t: number, look: { yaw: number; pitch: number }): Pose {
  p.clear();
  const br = Math.sin(t * 2.2) * 0.008;
  p.lift = br * 0.3;
  p.set(B.chest, br);
  // the brush hangs in a low curve, swaying a little
  const sway = Math.sin(t * 0.8) * 0.12;
  p.set(B.tail1, -0.55, sway * 0.4);
  p.set(B.tail2, -0.25, sway * 0.6);
  p.set(B.tail3, -0.05, sway * 0.6);
  p.set(B.tail4, 0.1, sway * 0.5);
  p.set(B.tail5, 0.18, sway * 0.4);
  headLook(p, look.yaw, look.pitch, t);
  return p;
}

/** Leg swing helper: phase p in [0, 1), stance first (fraction `duty`), then swing. Returns [sweep -1..1, lift 0..1]. */
export function legCycle(ph: number, duty: number): [number, number] {
  const p = ph - Math.floor(ph);
  if (p < duty) {
    // stance: the foot planted, the leg sweeping from front to back
    const u = p / duty;
    return [-1 + 2 * u, 0];
  }
  // swing: lift and bring the leg forward on a smooth curve
  const u = (p - duty) / (1 - duty);
  const back = 1 - 2 * (0.5 - 0.5 * Math.cos(Math.PI * u));
  return [back, Math.sin(Math.PI * u)];
}

/**
 * The trot at `speed` m/s; `phase` is the stride phase (0..1). `amp` scales
 * the leg sweep (from the stride length). `turn` (rad/s) leans the body.
 */
export function poseTrot(p: Pose, phase: number, speed: number, t: number, turn = 0): Pose {
  p.clear();
  const k = Math.min(1, speed / 1.6);
  const sweep = 0.38 + 0.16 * k;
  const duty = 0.52;
  // diagonal pairs: left fore + right hind, right fore + left hind
  const legs: [number, number, number, number, boolean][] = [
    [B.shoulderL, B.elbowL, B.wristL, 0.0, true],
    [B.shoulderR, B.elbowR, B.wristR, 0.5, true],
    [B.hipL, B.kneeL, B.hockL, 0.5, false],
    [B.hipR, B.kneeR, B.hockR, 0.0, false],
  ];
  for (const [b0, b1, b2, off, fore] of legs) {
    const [sw, lift] = legCycle(phase + off, duty);
    if (fore) {
      // fore: shoulder sweeps; the elbow and wrist fold the paw back and up in the swing
      p.set(b0, sw * sweep * 0.9 - 0.05);
      p.set(b1, lift * 0.75 * k + 0.06);
      p.set(b2, lift * 1.1 * k - 0.05 * (1 - lift));
    } else {
      // hind: the hip sweeps; the stifle and hock fold in the swing
      p.set(b0, sw * sweep - 0.1 - lift * 0.25 * k);
      p.set(b1, lift * 0.55 * k);
      p.set(b2, -lift * 0.7 * k);
    }
  }
  // body: a bob twice per stride, a little roll from side to side, a lean into turns
  const bob = Math.cos(phase * Math.PI * 4);
  p.lift = -0.008 * k + bob * 0.007 * k;
  p.set(B.hips, -0.03 * k, 0, Math.sin(phase * Math.PI * 2) * 0.035 * k - turn * 0.05);
  p.set(B.spine, 0.02 * k, -turn * 0.06);
  p.set(B.chest, bob * 0.012 * k, -turn * 0.06);
  // head carried level and a touch low, steady while the body bobs
  p.set(B.neck, 0.1 * k - bob * 0.01, turn * 0.12);
  p.set(B.head, -0.05 * k + bob * 0.012, turn * 0.1);
  // the brush streams out behind, rising and waving
  const w = Math.sin(phase * Math.PI * 2 + 1.2);
  p.set(B.tail1, -0.3 + 0.12 * k, w * 0.08 - turn * 0.12);
  p.set(B.tail2, -0.06, w * 0.1 - turn * 0.1);
  p.set(B.tail3, 0.0, w * 0.1);
  p.set(B.tail4, 0.04, w * 0.08);
  p.set(B.tail5, 0.06, w * 0.06);
  headLook(p, 0, 0, t, 0.7);
  return p;
}

/** Nose down in the snow, listening. */
export function poseSniff(p: Pose, t: number, depth = 1): Pose {
  p.clear();
  const d = depth;
  p.lift = -0.02 * d;
  p.set(B.hips, -0.04 * d);
  p.set(B.chest, 0.12 * d);
  p.set(B.shoulderL, -0.15 * d);
  p.set(B.shoulderR, -0.12 * d);
  p.set(B.elbowL, 0.25 * d);
  p.set(B.elbowR, 0.22 * d);
  p.set(B.wristL, -0.12 * d);
  p.set(B.wristR, -0.1 * d);
  p.set(B.hipL, 0.05);
  p.set(B.hipR, 0.05);
  const nod = Math.sin(t * 5.3) * 0.04 * (0.5 + 0.5 * Math.sin(t * 0.7));
  p.set(B.neck, 0.75 * d, Math.sin(t * 0.6) * 0.15);
  p.set(B.head, 0.45 * d + nod, Math.sin(t * 0.6 + 0.5) * 0.12);
  const sway = Math.sin(t * 1.4) * 0.2;
  p.set(B.tail1, -0.35, sway * 0.5);
  p.set(B.tail2, -0.15, sway * 0.6);
  p.set(B.tail3, 0.0, sway * 0.6);
  p.set(B.tail4, 0.08, sway * 0.5);
  p.set(B.tail5, 0.12, sway * 0.4);
  headLook(p, 0, 0, t, 1);
  return p;
}

/** Sitting on its haunches; `look` turns and lifts the head (to the aurora at night). */
export function poseSit(p: Pose, t: number, look: { yaw: number; pitch: number }): Pose {
  p.clear();
  const body = -0.62;
  p.lift = -0.11;
  p.shift = -0.01;
  p.set(B.hips, body);
  p.set(B.spine, -0.06);
  p.set(B.chest, -0.05 + Math.sin(t * 1.9) * 0.008);
  const tilt = body - 0.11;
  // forelegs: straight down to the ground (undo the body's tilt)
  p.set(B.shoulderL, -tilt + 0.06);
  p.set(B.shoulderR, -tilt + 0.06);
  p.set(B.elbowL, 0.0);
  p.set(B.elbowR, 0.0);
  p.set(B.wristL, -0.02);
  p.set(B.wristR, -0.02);
  // hind legs folded: thighs forward along the ground, hocks flat behind
  p.set(B.hipL, -0.6, 0, 0.1);
  p.set(B.hipR, -0.6, 0, -0.1);
  p.set(B.kneeL, 2.05);
  p.set(B.kneeR, 2.05);
  p.set(B.hockL, -0.95);
  p.set(B.hockR, -0.95);
  // head brought level again and lifted by `look`
  p.set(B.neck, 0.38);
  p.set(B.head, 0.28);
  // the brush down to the ground and wrapped round the front paws
  const curl = 0.62;
  p.set(B.tail1, -1.05, 0.25);
  p.set(B.tail2, -0.3, curl);
  p.set(B.tail3, 0.0, curl);
  p.set(B.tail4, 0.05, curl);
  p.set(B.tail5, 0.05, curl * 0.8);
  headLook(p, look.yaw, look.pitch, t, 0.4);
  return p;
}

/**
 * The mousing pounce, u in [0, 1] over the whole move: crouch and wiggle
 * (0-0.3), spring up and arc (0.3-0.62), dive nose-first (0.62-0.72), head
 * buried (0.72-0.9), pop out (0.9-1). The body's height above the ground
 * path is in `p.lift`; the forward travel is `pounceLeap(u)`.
 */
export function posePounce(p: Pose, u: number, t: number): Pose {
  p.clear();
  const crouch = ss(0.0, 0.18, u) * (1 - ss(0.28, 0.33, u));
  const air = ss(0.3, 0.36, u) * (1 - ss(0.6, 0.66, u));
  const dive = ss(0.58, 0.66, u) * (1 - ss(0.88, 0.97, u));
  // body: low in the crouch, high in the arc, nose-down in the dive
  const arc = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.3) / 0.34)));
  p.lift = -0.06 * crouch + 0.5 * arc + 0.05 * dive;
  const pitch = -0.35 * air * (1 - ss(0.4, 0.55, u)) + 0.72 * dive + 0.45 * air * ss(0.45, 0.62, u);
  p.set(B.hips, pitch);
  // crouch: haunches wiggle, front legs folded, head low and still
  const wig = Math.sin(t * 9) * 0.06 * crouch;
  p.add(B.hips, 0, wig);
  p.set(B.shoulderL, -0.3 * crouch - 0.9 * dive - 0.4 * air);
  p.set(B.shoulderR, -0.3 * crouch - 0.9 * dive - 0.4 * air);
  p.set(B.elbowL, 0.6 * crouch + 0.2 * dive);
  p.set(B.elbowR, 0.6 * crouch + 0.2 * dive);
  p.set(B.wristL, -0.3 * crouch);
  p.set(B.wristR, -0.3 * crouch);
  p.set(B.hipL, -0.5 * crouch + 0.6 * air + 0.5 * dive);
  p.set(B.hipR, -0.5 * crouch + 0.6 * air + 0.5 * dive);
  p.set(B.kneeL, 0.9 * crouch - 0.2 * air);
  p.set(B.kneeR, 0.9 * crouch - 0.2 * air);
  p.set(B.hockL, -0.7 * crouch + 0.4 * air);
  p.set(B.hockR, -0.7 * crouch + 0.4 * air);
  p.set(B.neck, 0.35 * crouch + 0.35 * dive);
  p.set(B.head, 0.35 * crouch + 0.3 * dive);
  // the brush: low in the crouch, up like a rudder in the air, straight up in the dive
  p.set(B.tail1, -0.4 * crouch + 0.3 * air + 0.55 * dive, wig * 2);
  p.set(B.tail2, -0.2 * crouch + 0.15 * dive);
  p.set(B.tail3, -0.05 * crouch + 0.1 * dive);
  p.set(B.tail4, 0.0);
  p.set(B.tail5, 0.1 * crouch - 0.1 * dive);
  headLook(p, 0, 0, t, 1);
  return p;
}

/** forward travel of the pounce (m) at u */
export function pounceLeap(u: number): number {
  return ss(0.3, 0.66, u) * 1.3;
}

const e = new THREE.Euler();
const qa = new THREE.Quaternion();

/** Write a pose into the bones (rest rotations are identity). */
export function applyPose(bones: THREE.Bone[], p: Pose, hipsRest: THREE.Vector3): void {
  for (let i = 1; i < NB; i++) {
    e.set(p.a[i * 3], p.a[i * 3 + 1], p.a[i * 3 + 2], 'YXZ');
    bones[i].quaternion.copy(qa.setFromEuler(e));
  }
  bones[B.hips].position.set(hipsRest.x, hipsRest.y + p.lift, hipsRest.z + p.shift);
}
