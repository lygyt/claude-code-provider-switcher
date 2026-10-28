# Single-Source Shortest Paths

Implement `shortestPaths` in `solution.js`.

```js
export function shortestPaths(n, edges, source) {}
```

The graph is directed with non-negative integer weights. `n` is the number of vertices (`0 .. n-1`). Each edge is `[u, v, weight]`, where `weight >= 0`.

Return an array `dist` where `dist[i]` is the minimum distance from `source` to vertex `i`, or `-1` when `i` is unreachable. `dist[source]` is always `0`.

Requirements:

- The graph may contain duplicate edges and self-loops.
- The source is a valid vertex index.
- The benchmark uses 20,000 vertices and 100,000 edges, with an adversarial edge order. The starter's Bellman-Ford relaxation is too slow; implement Dijkstra with a binary heap.
