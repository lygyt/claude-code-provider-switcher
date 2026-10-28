export function shortestPaths(n, edges, source) {
  const dist = new Array(n).fill(Infinity);
  dist[source] = 0;

  for (let pass = 0; pass < n - 1; pass += 1) {
    let changed = false;
    for (const [u, v, weight] of edges) {
      if (dist[u] !== Infinity && dist[u] + weight < dist[v]) {
        dist[v] = dist[u] + weight;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return dist.map((value) => (value === Infinity ? -1 : value));
}
