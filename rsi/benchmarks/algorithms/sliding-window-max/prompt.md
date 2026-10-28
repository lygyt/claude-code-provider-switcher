# Sliding Window Maximum

Implement `maxSlidingWindow` in `solution.js`.

```js
export function maxSlidingWindow(nums, k) {}
```

Return an array containing the maximum of every contiguous window of length `k`, from left to right.

Requirements:

- `1 <= k <= nums.length`.
- `nums` is an array of integers, possibly negative or duplicated.
- The result length is `nums.length - k + 1`.
- Do not mutate `nums`.
- The benchmark calls this with 300,000 numbers and `k = 1500`, repeated twice. The starter's nested scan is too slow; implement an O(n) monotonic deque.
