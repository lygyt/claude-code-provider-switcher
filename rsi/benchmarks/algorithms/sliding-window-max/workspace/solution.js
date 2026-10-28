export function maxSlidingWindow(nums, k) {
  const result = [];
  for (let start = 0; start + k <= nums.length; start += 1) {
    let maximum = -Infinity;
    for (let index = start; index < start + k; index += 1) {
      if (nums[index] > maximum) {
        maximum = nums[index];
      }
    }
    result.push(maximum);
  }
  return result;
}
