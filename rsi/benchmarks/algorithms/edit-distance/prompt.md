# Levenshtein Edit Distance

Implement `editDistance` in `solution.js`.

```js
export function editDistance(a, b) {}
```

Return the minimum number of single-character edits (insertion, deletion, or substitution) needed to turn string `a` into string `b`.

Requirements:

- Both arguments are strings; either may be empty.
- Match behavior is case-sensitive.
- The benchmark calls the function on pairs of 120-character strings. The starter solution recomputes the same subproblems recursively and is far too slow; implement an iterative dynamic program with O(a.length * b.length) time and O(min(a.length, b.length)) space.
- Do not change the exported function name or signature.
