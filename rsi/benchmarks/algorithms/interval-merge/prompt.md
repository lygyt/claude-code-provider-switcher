# Merge Intervals

Implement `mergeIntervals(intervals)` in `solution.js`.

`intervals` is an array of `[start, end]` pairs with integer endpoints. Merge every pair of overlapping or touching intervals and return the resulting array sorted by start.

Requirements:

- Return a new array; do not mutate the input or any inner array.
- Touching intervals such as `[1, 3]` and `[3, 5]` must merge into `[1, 5]`.
- The result must be sorted by start, then by end.
- Handle an empty input and duplicate intervals.
- Target complexity: O(n log n) time and O(n) extra space. `n` may be up to 100,000.

Export exactly:

```js
export function mergeIntervals(intervals) { /* ... */ }
```
