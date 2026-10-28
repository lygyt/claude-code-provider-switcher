export function isMatch(text, pattern) {
  if (pattern.length === 0) {
    return text.length === 0;
  }

  const firstMatches = text.length > 0 && (pattern[0] === "." || pattern[0] === text[0]);
  if (pattern.length >= 2 && pattern[1] === "*") {
    return isMatch(text, pattern.slice(2)) || (firstMatches && isMatch(text.slice(1), pattern));
  }
  return firstMatches && isMatch(text.slice(1), pattern.slice(1));
}
