export class EventBus {
    handlers = new Map();
    on(name, handler) {
        let set = this.handlers.get(name);
        if (!set)
            this.handlers.set(name, (set = new Set()));
        set.add(handler);
        return () => set.delete(handler);
    }
    once(name, handler) {
        const off = this.on(name, (p) => {
            off();
            handler(p);
        });
        return off;
    }
    emit(name, payload = {}) {
        const set = this.handlers.get(name);
        if (!set)
            return;
        for (const h of [...set]) {
            try {
                h(payload);
            }
            catch (err) {
                console.error(`[events] handler for "${name}" failed`, err);
            }
        }
    }
}
export const events = new EventBus();
