import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, isMatch } from '../src/utils/embedding.js';

test('cosineSimilarity returns 1 for identical vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
});

test('cosineSimilarity returns -1 for opposite vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
});

test('cosineSimilarity throws on mismatched vector length', () => {
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]));
});

test('isMatch respects the threshold argument', () => {
  const a = [1, 0];
  const b = [0.99, 0.14]; // cosine sim ~0.99
  assert.equal(isMatch(a, b, 0.95), true);
  assert.equal(isMatch(a, b, 0.999), false);
});
