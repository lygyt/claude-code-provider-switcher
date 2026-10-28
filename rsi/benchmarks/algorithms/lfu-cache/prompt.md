# LFU Cache with LRU Tie-Breaking

Implement `LFUCache` in `solution.js`.

```js
export class LFUCache {
  constructor(capacity) {}
  get(key) {}
  put(key, value) {}
}
```

Requirements:

- `capacity` is a non-negative integer. When it is `0`, `put` does nothing and `get` returns `-1`.
- Keys and values are integers.
- `get(key)` returns the stored value, or `-1` when the key is absent. A successful lookup is a use.
- `put(key, value)` inserts or updates a key. Every successful `put` on an existing key updates the value and is also a use.
- A new key starts with access frequency `1`.
- On a use, the key's access frequency increases by `1`.
- When inserting into a full cache, evict the key with the lowest access frequency. Break ties by evicting the least recently used key among those with the same frequency.
- Among keys with the same frequency, "used" means either a successful `get` or an existing-key `put`. Inserting a new key also makes it the most recently used key at frequency `1`.
- Target `O(1)` average time per operation.

The benchmark performs 100,000 mixed operations against a capacity of 8,000. The starter scans every entry on eviction, which is too slow; use frequency buckets whose members are kept in recency order.
