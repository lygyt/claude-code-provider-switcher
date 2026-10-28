// Correct reference implementations used by harness tests and the demo.
// They are kept as strings so tests can feed them through the same proposal
// validation path a real model would use.

const intervalMerge = `export function mergeIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = intervals.map(([start, end]) => [start, end]).sort((left, right) => left[0] - right[0]);
  const result = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const [start, end] = sorted[index];
    const last = result[result.length - 1];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      result.push([start, end]);
    }
  }
  return result;
}
`;

const lruCache = `export class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) {
      return -1;
    }
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  put(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value);
    }
  }
}
`;

const topKFrequent = `export function topKFrequent(nums, k) {
  const counts = new Map();
  for (const value of nums) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, k)
    .map(([value]) => value);
}
`;

const editDistance = `export function editDistance(a, b) {
  if (a.length < b.length) {
    return editDistance(b, a);
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const code = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (code === b.charCodeAt(j - 1) ? 0 : 1);
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      current[j] = substitution < deletion ? (substitution < insertion ? substitution : insertion) : deletion < insertion ? deletion : insertion;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}
`;

const slidingWindowMax = `export function maxSlidingWindow(nums, k) {
  const result = [];
  const deque = [];
  let head = 0;
  for (let index = 0; index < nums.length; index += 1) {
    while (deque.length > head && nums[deque[deque.length - 1]] <= nums[index]) {
      deque.pop();
    }
    deque.push(index);
    if (deque[head] <= index - k) {
      head += 1;
    }
    if (index >= k - 1) {
      result.push(nums[deque[head]]);
    }
  }
  return result;
}
`;

const unionFind = `export class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, index) => index);
    this.size = new Array(n).fill(1);
  }

  find(x) {
    let root = x;
    while (this.parent[root] !== root) {
      this.parent[root] = this.parent[this.parent[root]];
      root = this.parent[root];
    }
    return root;
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) {
      return;
    }
    if (this.size[rootA] < this.size[rootB]) {
      [rootA, rootB] = [rootB, rootA];
    }
    this.parent[rootB] = rootA;
    this.size[rootA] += this.size[rootB];
  }

  connected(a, b) {
    return this.find(a) === this.find(b);
  }
}
`;

const medianStream = `class MaxHeap {
  constructor() {
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  peek() {
    return this.values[0];
  }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (values[parent] >= values[index]) break;
      [values[parent], values[index]] = [values[index], values[parent]];
      index = parent;
    }
  }

  pop() {
    const values = this.values;
    const top = values[0];
    const last = values.pop();
    if (values.length) {
      values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let largest = index;
        if (left < values.length && values[left] > values[largest]) largest = left;
        if (right < values.length && values[right] > values[largest]) largest = right;
        if (largest === index) break;
        [values[largest], values[index]] = [values[index], values[largest]];
        index = largest;
      }
    }
    return top;
  }
}

class MinHeap {
  constructor() {
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  peek() {
    return this.values[0];
  }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (values[parent] <= values[index]) break;
      [values[parent], values[index]] = [values[index], values[parent]];
      index = parent;
    }
  }

  pop() {
    const values = this.values;
    const top = values[0];
    const last = values.pop();
    if (values.length) {
      values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < values.length && values[left] < values[smallest]) smallest = left;
        if (right < values.length && values[right] < values[smallest]) smallest = right;
        if (smallest === index) break;
        [values[smallest], values[index]] = [values[index], values[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

export class MedianFinder {
  constructor() {
    this.lower = new MaxHeap();
    this.upper = new MinHeap();
  }

  addNum(num) {
    if (this.lower.size === 0 || num <= this.lower.peek()) {
      this.lower.push(num);
    } else {
      this.upper.push(num);
    }
    if (this.lower.size > this.upper.size + 1) {
      this.upper.push(this.lower.pop());
    } else if (this.upper.size > this.lower.size) {
      this.lower.push(this.upper.pop());
    }
  }

  findMedian() {
    if (this.lower.size > this.upper.size) {
      return this.lower.peek();
    }
    return (this.lower.peek() + this.upper.peek()) / 2;
  }
}
`;

const dijkstra = `class MinHeap {
  constructor() {
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  push(entry) {
    const values = this.values;
    values.push(entry);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (values[parent][0] <= values[index][0]) break;
      [values[parent], values[index]] = [values[index], values[parent]];
      index = parent;
    }
  }

  pop() {
    const values = this.values;
    const top = values[0];
    const last = values.pop();
    if (values.length) {
      values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < values.length && values[left][0] < values[smallest][0]) smallest = left;
        if (right < values.length && values[right][0] < values[smallest][0]) smallest = right;
        if (smallest === index) break;
        [values[smallest], values[index]] = [values[index], values[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

export function shortestPaths(n, edges, source) {
  const adjacency = Array.from({ length: n }, () => []);
  for (const [u, v, weight] of edges) {
    adjacency[u].push([v, weight]);
  }

  const dist = new Array(n).fill(Infinity);
  dist[source] = 0;
  const heap = new MinHeap();
  heap.push([0, source]);
  while (heap.size) {
    const [distance, vertex] = heap.pop();
    if (distance !== dist[vertex]) continue;
    for (const [next, weight] of adjacency[vertex]) {
      const candidate = distance + weight;
      if (candidate < dist[next]) {
        dist[next] = candidate;
        heap.push([candidate, next]);
      }
    }
  }

  return dist.map((value) => (value === Infinity ? -1 : value));
}
`;

export const referenceSolutions = {
  "algorithms/interval-merge": { "solution.js": intervalMerge },
  "algorithms/lru-cache": { "solution.js": lruCache },
  "algorithms/top-k-frequent": { "solution.js": topKFrequent },
  "algorithms/edit-distance": { "solution.js": editDistance },
  "algorithms/sliding-window-max": { "solution.js": slidingWindowMax },
  "algorithms/union-find": { "solution.js": unionFind },
  "algorithms/median-stream": { "solution.js": medianStream },
  "algorithms/dijkstra": { "solution.js": dijkstra }
};

export {
  intervalMerge,
  lruCache,
  topKFrequent,
  editDistance,
  slidingWindowMax,
  unionFind,
  medianStream,
  dijkstra
};
