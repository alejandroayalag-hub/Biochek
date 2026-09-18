import { cosineSimilarity, isMatch } from '../src/lib/embedding';

test('cosineSimilarity returns 1 for identical vectors', () => {
  expect(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1)).toBeLessThan(1e-9);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  expect(Math.abs(cosineSimilarity([1, 0], [0, 1]))).toBeLessThan(1e-9);
});

test('isMatch respects the threshold argument', () => {
  const a = [1, 0];
  const b = [0.99, 0.14];
  expect(isMatch(a, b, 0.95)).toBe(true);
  expect(isMatch(a, b, 0.999)).toBe(false);
});
