export class LFUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.entries = new Map();
    this.clock = 0;
  }

  touch(entry) {
    entry.frequency += 1;
    entry.lastUsed = ++this.clock;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return -1;
    }
    this.touch(entry);
    return entry.value;
  }

  put(key, value) {
    if (this.capacity === 0) {
      return;
    }
    const existing = this.entries.get(key);
    if (existing) {
      existing.value = value;
      this.touch(existing);
      return;
    }
    if (this.entries.size >= this.capacity) {
      let victimKey;
      let victim;
      for (const [candidateKey, candidate] of this.entries) {
        if (
          victim === undefined ||
          candidate.frequency < victim.frequency ||
          (candidate.frequency === victim.frequency && candidate.lastUsed < victim.lastUsed)
        ) {
          victimKey = candidateKey;
          victim = candidate;
        }
      }
      this.entries.delete(victimKey);
    }
    this.entries.set(key, { value, frequency: 1, lastUsed: ++this.clock });
  }
}
