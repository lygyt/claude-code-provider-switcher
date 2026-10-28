export class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, index) => index);
  }

  find(x) {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    return root;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootA] = rootB;
    }
  }

  connected(a, b) {
    return this.find(a) === this.find(b);
  }
}
