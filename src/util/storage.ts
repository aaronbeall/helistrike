/** Persistent key/value storage behind a swappable async backend (values are JSON-serializable). */
export interface KeyValueStore {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every entry whose key starts with `prefix`. */
  list<T>(prefix: string): Promise<[string, T][]>;
}

/** IndexedDB: one object store of JSON values keyed by string. Any failure reads as empty / drops the write. */
export class IndexedDbStore implements KeyValueStore {
  private db: Promise<IDBDatabase | undefined>;

  constructor(name = "helistrike", private readonly storeName = "kv") {
    this.db = new Promise((resolve) => {
      try {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(storeName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
        req.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  private async run<R>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<R>): Promise<R | undefined> {
    const db = await this.db;
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const req = op(db.transaction(this.storeName, mode).objectStore(this.storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async read<T>(key: string): Promise<T | undefined> {
    return (await this.run("readonly", (s) => s.get(key))) as T | undefined;
  }

  async write(key: string, value: unknown): Promise<void> {
    // Round-trip through JSON so stored values match every other backend.
    await this.run("readwrite", (s) => s.put(JSON.parse(JSON.stringify(value)), key));
  }

  async remove(key: string): Promise<void> {
    await this.run("readwrite", (s) => s.delete(key));
  }

  async list<T>(prefix: string): Promise<[string, T][]> {
    const range = IDBKeyRange.bound(prefix, prefix + "￿");
    const keys = (await this.run("readonly", (s) => s.getAllKeys(range))) ?? [];
    const values = (await this.run("readonly", (s) => s.getAll(range))) ?? [];
    return keys.map((k, i) => [String(k), values[i] as T]);
  }
}

/** Browser localStorage, namespaced; any failure (private mode, quota, blocked) is swallowed. */
export class LocalStorageStore implements KeyValueStore {
  constructor(private readonly prefix = "helistrike:") {}

  async read<T>(key: string): Promise<T | undefined> {
    try {
      const raw = globalThis.localStorage?.getItem(this.prefix + key);
      return raw == null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    try {
      globalThis.localStorage?.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // Storage unavailable: data lives for this session only.
    }
  }

  async remove(key: string): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(this.prefix + key);
    } catch {
      // Ignore.
    }
  }

  async list<T>(prefix: string): Promise<[string, T][]> {
    const out: [string, T][] = [];
    try {
      const ls = globalThis.localStorage;
      if (!ls) return out;
      const full = this.prefix + prefix;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k?.startsWith(full)) continue;
        const raw = ls.getItem(k);
        if (raw != null) out.push([k.slice(this.prefix.length), JSON.parse(raw) as T]);
      }
    } catch {
      // Ignore.
    }
    return out;
  }
}

/** Session-only store (tests, headless tools, or no browser storage). */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async read<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  }

  async write(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list<T>(prefix: string): Promise<[string, T][]> {
    const out: [string, T][] = [];
    for (const [k, raw] of this.data) if (k.startsWith(prefix)) out.push([k, JSON.parse(raw) as T]);
    return out;
  }
}

function defaultStore(): KeyValueStore {
  if (typeof indexedDB !== "undefined") return new IndexedDbStore();
  if (typeof localStorage !== "undefined") return new LocalStorageStore();
  return new MemoryStore();
}

let active: KeyValueStore = defaultStore();

/** The active store. */
export function storage(): KeyValueStore {
  return active;
}

/** Swap the backend (e.g. a cloud or file store). */
export function setStorage(store: KeyValueStore): void {
  active = store;
}
