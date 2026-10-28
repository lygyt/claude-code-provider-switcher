export function topKFrequent(nums, k) {
  const counts = new Map();
  for (const value of nums) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const ranked = [...counts.keys()].map((value) => ({
    value,
    count: nums.filter((entry) => entry === value).length
  }));

  ranked.sort((left, right) => right.count - left.count || left.value - right.value);
  return ranked.slice(0, k).map((entry) => entry.value);
}
