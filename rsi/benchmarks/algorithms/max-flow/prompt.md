# Maximum Flow

Implement `maxFlow` in `solution.js`.

```js
export function maxFlow(n, edges, source, sink) {}
```

The graph is directed. Vertices are integers `0 .. n-1`. Each edge is `[u, v, capacity]`:

- `capacity` is a non-negative integer.
- Parallel edges and self-loops are allowed.
- Return the value of a maximum `source`-to-`sink` flow.
- If `source === sink`, return `0`.
- Do not mutate the `edges` array or its inner arrays.

The benchmark has 4,000 unit-capacity paths plus a large set of dead-end decoy edges. A plain Edmonds-Karp implementation re-scans the decoys on every augmentation and is too slow; implement Dinic's algorithm with a level graph and blocking flow.
