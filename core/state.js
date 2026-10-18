/**
 * Global, observable application state of Foxfire Fjord (camera mode, where
 * the visitor is, whether the interface shows). Mutate through the setters
 * where there is one; changes are announced on the event bus.
 */
import { events } from './events.js';
class AppState {
    mode = 'orbit';
    uiVisible = true;
    /** id of the named area the camera is currently in (see CameraRig location ids) */
    location = 'overview';
    /** true when the camera is inside the cabin or its glass wing */
    inside = false;
    /** which room the camera is in when inside ('living' | 'glasswing'), else null */
    room = null;
    setMode(mode) {
        if (this.mode === mode)
            return;
        this.mode = mode;
        events.emit('mode-changed', { mode });
    }
}
export const state = new AppState();
