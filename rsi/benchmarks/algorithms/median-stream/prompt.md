# Streaming Median

Implement `MedianFinder` in `solution.js`.

```js
export class MedianFinder {
  constructor() {}
  addNum(num) {}
  findMedian() {}
}
```

Requirements:

- `addNum(num)` inserts an integer into the stream. Values may be negative and may repeat.
- `findMedian()` returns the median of all values added so far. For an odd count it is the middle value; for an even count it is the average of the two middle values.
- `findMedian()` is only called after at least one value has been added.
- The benchmark adds 100,000 values and calls `findMedian()` after every insertion. Sorting the whole stream each time is too slow; use two heaps or another logarithmic structure.
