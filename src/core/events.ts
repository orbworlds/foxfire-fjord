/**
 * Minimal event bus shared by all systems and features.
 *
 * Known events (payloads):
 *   'time-changed'     { hours }                          time of day moved
 *   'mode-changed'     { mode: 'orbit' | 'walk' }         camera mode
 *   'viewpoint'        { id }                             a tour viewpoint was selected
 *   'quality-changed'  { quality }                        quality preset changed
 *   'cabin:light'      { zone, lamps, fire }              a room's lamps / stove changed (house feature)
 *   'location'         { id, label }                      the named area the camera is in (CameraRig)
 *   'walk:step'        { surface, speed, left }           a footfall in walk mode (snow | packed | wood | ice)
 *   'weather-changed'  { weather }                        the sky's weather target changed
 *   'tour:start' / 'tour:stop' { index, id } / 'tour:end' / 'intro:end' { skipped }   interface story beats
 *   'features-ready'   {}                                 all features finished loading
 * Features may define their own namespaced events, e.g. 'cabin:light'.
 */
type Handler = (payload: any) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(name: string, handler: Handler): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  once(name: string, handler: Handler): () => void {
    const off = this.on(name, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  emit(name: string, payload: unknown = {}): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" failed`, err);
      }
    }
  }
}

export const events = new EventBus();
