export function countPatterns(text, patterns) {
  const counts = new Array(patterns.length).fill(0);
  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
    const pattern = patterns[patternIndex];
    for (let start = 0; start + pattern.length <= text.length; start += 1) {
      let matched = true;
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (text[start + offset] !== pattern[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        counts[patternIndex] += 1;
      }
    }
  }
  return counts;
}
