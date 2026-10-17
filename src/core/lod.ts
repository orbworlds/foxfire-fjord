import * as THREE from 'three';

interface LodEntry {
  object: THREE.Object3D;
  maxDistance: number;
  minDistance: number;
  center: THREE.Vector3;
}

/**
 * Distance-based visibility. Register detail that is pointless far away
 * (interior props, small outdoor props) so it stops costing draw calls.
 *
 *   ctx.lod.register(kitchenGroup, 80)                 // hide beyond 80 m
 *   ctx.lod.register(farImpostor, Infinity, center, 80) // show only beyond 80 m
 */
export class LodManager {
  private entries: LodEntry[] = [];
  private timer = 0;

  register(object: THREE.Object3D, maxDistance: number, center?: THREE.Vector3, minDistance = 0): () => void {
    let c = center;
    if (!c) {
      const box = new THREE.Box3().setFromObject(object);
      c = box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    }
    const e: LodEntry = { object, maxDistance, minDistance, center: c.clone() };
    this.entries.push(e);
    return () => {
      const i = this.entries.indexOf(e);
      if (i >= 0) this.entries.splice(i, 1);
    };
  }

  update(dt: number, cameraPos: THREE.Vector3, force = false): void {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.2;
    for (const e of this.entries) {
      const d = e.center.distanceTo(cameraPos);
      e.object.visible = d <= e.maxDistance && d >= e.minDistance;
    }
  }
}
