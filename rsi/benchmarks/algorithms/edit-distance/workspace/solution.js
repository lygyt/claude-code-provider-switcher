export function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const cost = a[0] === b[0] ? 0 : 1;
  return Math.min(
    editDistance(a.slice(1), b.slice(1)) + cost,
    editDistance(a.slice(1), b) + 1,
    editDistance(a, b.slice(1)) + 1
  );
}
