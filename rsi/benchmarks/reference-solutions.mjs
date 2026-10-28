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

const lfuCache = `export class LFUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.entries = new Map();
    this.frequencies = new Map();
    this.minFrequency = 0;
  }

  bucketFor(frequency) {
    let bucket = this.frequencies.get(frequency);
    if (!bucket) {
      bucket = new Map();
      this.frequencies.set(frequency, bucket);
    }
    return bucket;
  }

  touch(entry) {
    const oldFrequency = entry.frequency;
    const oldBucket = this.frequencies.get(oldFrequency);
    oldBucket.delete(entry.key);
    if (oldBucket.size === 0) {
      this.frequencies.delete(oldFrequency);
      if (this.minFrequency === oldFrequency) {
        this.minFrequency = oldFrequency + 1;
      }
    }
    entry.frequency += 1;
    this.bucketFor(entry.frequency).set(entry.key, entry);
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
      const bucket = this.frequencies.get(this.minFrequency);
      const victimKey = bucket.keys().next().value;
      bucket.delete(victimKey);
      this.entries.delete(victimKey);
      if (bucket.size === 0) {
        this.frequencies.delete(this.minFrequency);
      }
    }
    const entry = { key, value, frequency: 1 };
    this.entries.set(key, entry);
    this.bucketFor(1).set(key, entry);
    this.minFrequency = 1;
  }
}
`;

const regexMatch = `export function isMatch(text, pattern) {
  const rows = pattern.length + 1;
  const columns = text.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(columns).fill(false));
  dp[0][0] = true;

  for (let row = 2; row < rows; row += 1) {
    if (pattern[row - 1] === "*") {
      dp[row][0] = dp[row - 2][0];
    }
  }

  for (let row = 1; row < rows; row += 1) {
    const token = pattern[row - 1];
    for (let column = 1; column < columns; column += 1) {
      if (token === "*") {
        const previous = pattern[row - 2];
        dp[row][column] =
          dp[row - 2][column] ||
          ((previous === "." || previous === text[column - 1]) && dp[row][column - 1]);
      } else {
        dp[row][column] = (token === "." || token === text[column - 1]) && dp[row - 1][column - 1];
      }
    }
  }

  return dp[rows - 1][columns - 1];
}
`;

const ahoCorasick = `export function countPatterns(text, patterns) {
  if (patterns.length === 0) {
    return [];
  }

  const children = [new Map()];
  const failure = [0];
  const terminals = [[]];
  const newNode = () => {
    children.push(new Map());
    failure.push(0);
    terminals.push([]);
    return children.length - 1;
  };

  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
    let node = 0;
    for (const character of patterns[patternIndex]) {
      let next = children[node].get(character);
      if (next === undefined) {
        next = newNode();
        children[node].set(character, next);
      }
      node = next;
    }
    terminals[node].push(patternIndex);
  }

  const queue = [];
  for (const child of children[0].values()) {
    failure[child] = 0;
    queue.push(child);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    for (const [character, child] of children[node]) {
      let fallback = failure[node];
      while (fallback !== 0 && !children[fallback].has(character)) {
        fallback = failure[fallback];
      }
      const target = children[fallback].get(character);
      failure[child] = target === undefined || target === child ? 0 : target;
      queue.push(child);
    }
  }

  const visits = new Array(children.length).fill(0);
  let state = 0;
  for (const character of text) {
    while (state !== 0 && !children[state].has(character)) {
      state = failure[state];
    }
    state = children[state].get(character) ?? 0;
    visits[state] += 1;
  }

  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const node = queue[index];
    visits[failure[node]] += visits[node];
  }

  const counts = new Array(patterns.length).fill(0);
  for (let node = 0; node < children.length; node += 1) {
    for (const patternIndex of terminals[node]) {
      counts[patternIndex] += visits[node];
    }
  }
  return counts;
}
`;

const maxFlow = `export function maxFlow(n, edges, source, sink) {
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

  const level = new Array(n);
  const work = new Array(n);

  const buildLevels = () => {
    level.fill(-1);
    level[source] = 0;
    const queue = [source];
    for (let head = 0; head < queue.length; head += 1) {
      const vertex = queue[head];
      for (const edge of graph[vertex]) {
        if (edge.capacity > 0 && level[edge.to] === -1) {
          level[edge.to] = level[vertex] + 1;
          queue.push(edge.to);
        }
      }
    }
    return level[sink] !== -1;
  };

  const send = (vertex, available) => {
    if (vertex === sink) {
      return available;
    }
    for (; work[vertex] < graph[vertex].length; work[vertex] += 1) {
      const edge = graph[vertex][work[vertex]];
      if (edge.capacity > 0 && level[edge.to] === level[vertex] + 1) {
        const pushed = send(edge.to, Math.min(available, edge.capacity));
        if (pushed > 0) {
          edge.capacity -= pushed;
          graph[edge.to][edge.reverse].capacity += pushed;
          return pushed;
        }
      }
    }
    return 0;
  };

  let total = 0;
  while (buildLevels()) {
    work.fill(0);
    let pushed = send(source, Number.MAX_SAFE_INTEGER);
    while (pushed > 0) {
      total += pushed;
      pushed = send(source, Number.MAX_SAFE_INTEGER);
    }
  }
  return total;
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
  "algorithms/dijkstra": { "solution.js": dijkstra },
  "algorithms/lfu-cache": { "solution.js": lfuCache },
  "algorithms/regex-match": { "solution.js": regexMatch },
  "algorithms/aho-corasick": { "solution.js": ahoCorasick },
  "algorithms/max-flow": { "solution.js": maxFlow }
};

export {
  intervalMerge,
  lruCache,
  topKFrequent,
  editDistance,
  slidingWindowMax,
  unionFind,
  medianStream,
  dijkstra,
  lfuCache,
  regexMatch,
  ahoCorasick,
  maxFlow
};
