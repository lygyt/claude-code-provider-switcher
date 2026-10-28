# Regular Expression Matching

Implement `isMatch` in `solution.js`.

```js
export function isMatch(text, pattern) {}
```

Return `true` when `pattern` matches the **entire** `text`.

The pattern language is deliberately small:

- A lowercase letter matches itself.
- `.` matches any single character.
- `*` matches zero or more copies of the **preceding element**. The pattern is always valid: `*` never appears first and never follows another `*`.
- There are no anchors, alternation, character classes, or escaping.

Requirements:

- Both arguments are ASCII strings.
- An empty pattern matches only an empty text.
- A pattern such as `a*` matches the empty string.
- The benchmark uses a 60-character text and a 20-character pattern with ten starred groups. The starter's recursive branching is exponential; implement the O(text.length * pattern.length) dynamic program.
