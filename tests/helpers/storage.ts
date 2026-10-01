/** A Map-backed `StorageLike`, so persistence tests never touch a real browser. */
export function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

export type MemoryStorage = ReturnType<typeof memoryStorage>;
