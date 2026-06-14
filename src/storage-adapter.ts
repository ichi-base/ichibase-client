// Pluggable persistence for the auth session. The SDK keeps the session in
// memory (so token reads are synchronous) and mirrors it here so it survives a
// reload. Browsers pass `localStorage`; React Native passes an AsyncStorage- or
// expo-secure-store-style adapter; Node/tests get the in-memory default.

export interface SessionStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** In-memory adapter (default) — session is lost on reload. */
export class MemoryStorage implements SessionStorage {
  private m = new Map<string, string>();
  getItem(key: string): string | null {
    return this.m.has(key) ? this.m.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.m.set(key, value);
  }
  removeItem(key: string): void {
    this.m.delete(key);
  }
}
