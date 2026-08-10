'use strict';

const SEED_CHALLENGES = Object.freeze([
  {
    title: 'Two Sum',
    difficulty: 'Easy',
    score: 10,
    tags: ['array', 'hash-table'],
    statement: 'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.',
    constraintsText: '2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9',
    referenceSolutionPython: `def twoSum(nums, target):
    lookup = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in lookup:
            return [lookup[diff], i]
        lookup[num] = i
    return []`,
    starterTemplates: {
      python: 'def twoSum(nums, target):\n    pass',
      javascript: 'function twoSum(nums, target) {\n}',
    },
    testCases: [
      { input: '[2, 7, 11, 15], 9', expectedOutput: '[0, 1]', visibility: 'visible' },
      { input: '[3, 2, 4], 6', expectedOutput: '[1, 2]', visibility: 'visible' },
      { input: '[3, 3], 6', expectedOutput: '[0, 1]', visibility: 'hidden' },
    ],
    negativeSolutionPython: `def twoSum(nums, target):\n    return [0, 0]`,
  },
  {
    title: 'Reverse String',
    difficulty: 'Easy',
    score: 10,
    tags: ['string', 'two-pointers'],
    statement: 'Write a function that reverses a string.',
    constraintsText: '1 <= s.length <= 10^5',
    referenceSolutionPython: `def reverseString(s):
    return s[::-1]`,
    starterTemplates: {
      python: 'def reverseString(s):\n    pass',
      javascript: 'function reverseString(s) {\n}',
    },
    testCases: [
      { input: '"hello"', expectedOutput: '"olleh"', visibility: 'visible' },
      { input: '"Hannah"', expectedOutput: '"hannaH"', visibility: 'hidden' },
    ],
    negativeSolutionPython: `def reverseString(s):\n    return s`,
  },
]);

module.exports = { SEED_CHALLENGES };
