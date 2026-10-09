/** The shared in-memory ObjectStorage from @kr/storage/testing, with a switch to make readiness probes fail. */
import type { ObjectStorage } from "@kr/storage";
import { createMemoryStorage as createSharedMemoryStorage } from "@kr/storage/testing";

export interface MemoryStorage extends ObjectStorage {
  failPing: boolean;
}

export function createMemoryStorage(): MemoryStorage {
  const inner = createSharedMemoryStorage();
  const storage: MemoryStorage = {
    failPing: false,
    put: (input) => inner.put(input),
    get: (key, range) => inner.get(key, range),
    head: (key) => inner.head(key),
    exists: (key) => inner.exists(key),
    delete: (key) => inner.delete(key),
    list: (prefix, options) => inner.list(prefix, options),
    ping: () => (storage.failPing ? Promise.reject(new Error("storage down")) : inner.ping()),
  };
  return storage;
}
