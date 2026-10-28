export class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = [];
  }

  get(key) {
    const index = this.items.findIndex((item) => item.key === key);
    if (index === -1) {
      return -1;
    }
    const [item] = this.items.splice(index, 1);
    this.items.push(item);
    return item.value;
  }

  put(key, value) {
    const index = this.items.findIndex((item) => item.key === key);
    if (index !== -1) {
      this.items.splice(index, 1);
    }
    this.items.push({ key, value });
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }
}
