export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      result.push([start, end]);
    }
  }
  return result;
}
