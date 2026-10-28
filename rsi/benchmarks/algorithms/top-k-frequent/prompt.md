# Top K Frequent Elements

Implement `topKFrequent` in `solution.js`.

```js
export function topKFrequent(nums, k) {}
```

Requirements:

- `nums` is an array of integers; values may be negative, zero, or repeated.
- `k` is an integer with `1 <= k <= number of distinct values`.
- Return exactly the `k` most frequent values, ordered by frequency descending.
- Break ties by value ascending. For example, `[4, 4, 1, 1, 2]` with `k = 2` returns `[1, 4]`.
- The result must be deterministic and contain no duplicates.
- The benchmark calls this with 100,000 numbers and 2,000 distinct values. Recomputing counts with a full scan per distinct value is too slow; use a hash map and a better selection or sort.
