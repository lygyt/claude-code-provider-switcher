export function maxFlow(n, edges, source, sink) {
  if (source === sink) {
    return 0;
  }

  const graph = Array.from({ length: n }, () => []);
  const addEdge = (from, to, capacity) => {
    const forward = { to, capacity, reverse: graph[to].length };
    const backward = { to: from, capacity: 0, reverse: graph[from].length };
    graph[from].push(forward);
    graph[to].push(backward);
  };

  for (const [from, to, capacity] of edges) {
    if (from !== to) {
      addEdge(from, to, capacity);
    }
  }

  let total = 0;
  while (true) {
    const parentVertex = new Array(n).fill(-1);
    const parentEdge = new Array(n).fill(-1);
    parentVertex[source] = source;
    const queue = [source];
    let head = 0;

    while (head < queue.length && parentVertex[sink] === -1) {
      const vertex = queue[head];
      head += 1;
      for (let index = 0; index < graph[vertex].length; index += 1) {
        const edge = graph[vertex][index];
        if (edge.capacity > 0 && parentVertex[edge.to] === -1) {
          parentVertex[edge.to] = vertex;
          parentEdge[edge.to] = index;
          if (edge.to === sink) {
            break;
          }
          queue.push(edge.to);
        }
      }
    }

    if (parentVertex[sink] === -1) {
      break;
    }

    let bottleneck = Infinity;
    for (let vertex = sink; vertex !== source; vertex = parentVertex[vertex]) {
      const previous = parentVertex[vertex];
      bottleneck = Math.min(bottleneck, graph[previous][parentEdge[vertex]].capacity);
    }

    for (let vertex = sink; vertex !== source; vertex = parentVertex[vertex]) {
      const previous = parentVertex[vertex];
      const edge = graph[previous][parentEdge[vertex]];
      edge.capacity -= bottleneck;
      graph[vertex][edge.reverse].capacity += bottleneck;
    }

    total += bottleneck;
  }

  return total;
}
