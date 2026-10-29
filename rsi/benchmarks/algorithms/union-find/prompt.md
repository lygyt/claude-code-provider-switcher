# Dynamic Connectivity (Union-Find)

Implement `UnionFind` in `solution.js`.

```js
export class UnionFind {
  constructor(n) {}
  find(x) {}
  union(a, b) {}
  connected(a, b) {}
}
```

Requirements:

- Elements are integers `0 .. n-1`.
- `find(x)` returns the representative of `x`'s set. Any deterministic representative is allowed, but it must be consistent: `find(a) === find(b)` exactly when `connected(a, b)` is true.
- `union(a, b)` merges the sets containing `a` and `b`. It is idempotent when they are already connected.
- `connected(a, b)` returns whether the elements are in the same set.
- Use path compression plus union by rank or size. The benchmark builds a 3,000,000-element chain with 2,999,999 unions, then performs 3,000,000 connectivity queries; a naive parent-chain implementation takes far too long.
