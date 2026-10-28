# Multi-Pattern Occurrence Counts

Implement `countPatterns` in `solution.js`.

```js
export function countPatterns(text, patterns) {}
```

Return an array of occurrence counts aligned with `patterns`:

- `counts[i]` is the number of times `patterns[i]` occurs in `text`.
- Occurrences may overlap.
- Duplicate entries in `patterns` are allowed and must receive the same count.
- Pattern matching is case-sensitive and byte-for-byte over ASCII strings.
- Every pattern is non-empty.
- When `patterns` is empty, return `[]`.

Examples:

```js
countPatterns("aaaa", ["a", "aa", "aaa", "aaaa"]) // [4, 3, 2, 1]
countPatterns("abab", ["ab", "ab", "b"])          // [2, 2, 2]
```

The benchmark uses a 200,000-character text and 1,000 patterns of length 12. Checking every pattern at every text position is far too slow; build an Aho-Corasick automaton with failure links. The intended complexity is O(total pattern length + text length + automaton states), not O(text * patterns * pattern length).
