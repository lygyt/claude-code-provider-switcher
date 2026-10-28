export class MedianFinder {
  constructor() {
    this.values = [];
  }

  addNum(num) {
    this.values.push(num);
  }

  findMedian() {
    const sorted = [...this.values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
      return sorted[middle];
    }
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
}
