/** The part of Web Storage the store needs; lets tests and non-browser hosts pass their own. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface LocalStore<T extends object> {
  get(): T;
  /** Shallow-merge a change and persist it. */
  patch(change: Partial<T>): T;
  reset(): T;
}

/**
 * A small persisted settings/progress object. Storage that is missing, full or blocked
 * (private windows, embedded previews) is tolerated: the store then simply lives in memory.
 * Unknown or corrupt stored data falls back to the defaults.
 */
export function createLocalStore<T extends object>(key: string, defaults: T, storage: KeyValueStorage | null = safeLocalStorage()): LocalStore<T> {
  let value: T = { ...defaults };
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) value = { ...defaults, ...(parsed as Partial<T>) };
    }
  } catch {
    value = { ...defaults };
  }
  const save = (): void => {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Persisting is best effort.
    }
  };
  return {
    get: () => value,
    patch(change) {
      value = { ...value, ...change };
      save();
      return value;
    },
    reset() {
      value = { ...defaults };
      try {
        storage?.removeItem(key);
      } catch {
        // Best effort.
      }
      return value;
    },
  };
}

/** `localStorage` when it exists and is usable, else null. */
export function safeLocalStorage(): KeyValueStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = "__kk_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
