# LRU Cache

Implement `LRUCache` in `solution.js` with O(1) average time for both operations.

```js
export class LRUCache {
  constructor(capacity) {}
  get(key) {}
  put(key, value) {}
}
```

Requirements:

- `get(key)` returns the stored value, or `-1` if the key is absent. A successful `get` marks the key as most recently used.
- `put(key, value)` inserts or updates a key and marks it as most recently used. If inserting exceeds `capacity`, evict the least recently used key.
- `capacity` is a positive integer.
- Keys and values are integers. Values may be negative or zero.
- `get` must not count as a use when the key is absent.
- The implementation will be exercised with 200,000 operations; the naive array scan is too slow.
