/**
 * The contract between Foxfire Fjord's core and every feature module.
 *
 * A feature lives in src/features/<id>/index.ts and default-exports a
 * FeatureFactory. The loader calls it once, adds `feature.object` to the
 * scene and calls `feature.update(dt, elapsed)` every frame.
 *
 *   import type { FeatureFactory } from '../../core/types';
 *   const create: FeatureFactory = (ctx) => {
 *     const root = new THREE.Group();
 *     …
 *     return { id: 'lake', object: root, update(dt, t) { … } };
 *   };
 *   export default create;
 */
import type * as THREE from 'three';
import type { Engine } from './engine';
import type { World } from '../world/world';
import type { SkySystem } from './sky';
import type { MaterialLibrary } from './materials';
import type { Interaction, InfoCard } from './interaction';
import type { Colliders } from './colliders';
import type { CameraRig } from './controls';
import type { LodManager } from './lod';
import type { EventBus } from './events';
import type { QualitySettings } from './quality';
import type { SharedUniforms } from './shared';
import type { state } from './state';
import type { params } from './params';

export interface Feature<API = unknown> {
  id: string;
  /** added to the scene by the loader (use world coordinates for its children) */
  object: THREE.Object3D;
  update?(dt: number, elapsed: number): void;
  dispose?(): void;
  /** optional public API other features / the UI can use via ctx.getFeature(id) */
  api?: API;
}

export type FeatureFactory = (ctx: FeatureContext) => Feature | Promise<Feature>;

export interface ControlSpec {
  /** which dock group the control appears in: 'house' shows near the cabin, 'feature' everywhere */
  group: 'house' | 'feature';
  id: string;
  label: string;
  /** optional icon key from ui/dom ICON (e.g. 'flame', 'lamp', 'blind', 'tub', 'fire'); a sensible one is picked by id otherwise */
  icon?: string;
  /** mutually exclusive presets share a set name and sit together in one segmented chip (e.g. 'blinds') */
  set?: string;
  /** buttons: each click calls onClick; toggles show an active state */
  kind?: 'button' | 'toggle';
  active?: () => boolean;
  onClick: () => void;
}

export interface UIApi {
  showCard(card: InfoCard): void;
  hideCard(): void;
  toast(text: string, ms?: number): void;
  /** add a button to the HUD dock (e.g. lamps, stove, blinds presets) */
  addControl(spec: ControlSpec): () => void;
  /** re-render control active states */
  refreshControls(): void;
}

export interface FeatureContext {
  engine: Engine;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  sky: SkySystem;
  materials: MaterialLibrary;
  interaction: Interaction;
  colliders: Colliders;
  controls: CameraRig;
  lod: LodManager;
  ui: UIApi;
  events: EventBus;
  state: typeof state;
  quality: QualitySettings;
  shared: SharedUniforms;
  params: typeof params;
  getFeature<API = unknown>(id: string): Feature<API> | undefined;
}
