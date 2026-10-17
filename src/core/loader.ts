import type { Feature, FeatureContext, FeatureFactory } from './types';
import { params } from './params';

export interface FeatureEntry {
  id: string;
  label: string;
  load: () => Promise<{ default: FeatureFactory }>;
}

export interface LoadReport {
  loaded: string[];
  failed: { id: string; error: string }[];
  timings: Record<string, number>;
  /** boot phases, ms since main() started (world, sky, texturesDone, texturesWait, features, snowify, precompile, ready) */
  phases?: Record<string, number>;
}

/**
 * Loads features one by one. A failing feature is logged and skipped so the
 * rest of the world still comes up.
 */
export async function loadFeatures(
  ctx: FeatureContext,
  registry: FeatureEntry[],
  features: Map<string, Feature>,
  onProgress: (fraction: number, label: string) => void,
  /** awaited before each feature loads (e.g. until the textures it needs are ready) */
  before?: (id: string) => Promise<unknown> | void,
): Promise<LoadReport> {
  const report: LoadReport = { loaded: [], failed: [], timings: {} };
  const selected = registry.filter((e) => (!params.solo || params.solo.includes(e.id)) && !(params.skip && params.skip.includes(e.id)));
  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i];
    onProgress(i / selected.length, entry.label);
    // give the browser a frame to paint progress
    await new Promise((r) => setTimeout(r, 0));
    if (before) await before(entry.id);
    const t0 = performance.now();
    try {
      const mod = await entry.load();
      const feature = await mod.default(ctx);
      if (!feature || !feature.object) throw new Error('factory did not return { object }');
      feature.id = feature.id || entry.id;
      ctx.scene.add(feature.object);
      features.set(entry.id, feature);
      if (feature.update) {
        const upd = feature.update.bind(feature);
        ctx.engine.onUpdate((dt, t) => upd(dt, t), 100);
      }
      report.loaded.push(entry.id);
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      console.error(`[loader] feature "${entry.id}" failed`, err);
      report.failed.push({ id: entry.id, error: msg });
    }
    report.timings[entry.id] = Math.round(performance.now() - t0);
  }
  onProgress(1, 'ready');
  return report;
}
