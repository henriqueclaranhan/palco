export interface RenderedPageEntry {
  key: string;
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
}

export class LruPageCache {
  private readonly capacity: number;
  private readonly entries = new Map<string, RenderedPageEntry>();

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get(key: string): RenderedPageEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(entry: RenderedPageEntry): void {
    if (this.entries.has(entry.key)) {
      this.entries.delete(entry.key);
    }
    this.entries.set(entry.key, entry);
    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
