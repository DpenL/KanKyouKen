/** Minimal typed event emitter; mechanics expose one so hosts can react without polling. */

export type Listener<T> = (event: T) => void;

export interface Emitter<T> {
  /** Subscribe; returns an unsubscribe function. */
  on(listener: Listener<T>): () => void;
  emit(event: T): void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<Listener<T>>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

/** Source of "now" in milliseconds. Injected so mechanics stay deterministic under test. */
export interface Clock {
  now(): number;
}

/** A clock the test (or a replay) advances by hand. */
export function createManualClock(start = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
}
