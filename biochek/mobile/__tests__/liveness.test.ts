import { evaluateLiveness } from '../src/lib/liveness';

test('evaluateLiveness is true when eyes go from open to closed to open (a blink)', () => {
  const frames = [
    { leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 },
    { leftEyeOpenProbability: 0.1, rightEyeOpenProbability: 0.1 },
    { leftEyeOpenProbability: 0.85, rightEyeOpenProbability: 0.88 },
  ];
  expect(evaluateLiveness(frames)).toBe(true);
});

test('evaluateLiveness is false when eyes stay open the whole time (a photo)', () => {
  const frames = [
    { leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 },
    { leftEyeOpenProbability: 0.92, rightEyeOpenProbability: 0.91 },
    { leftEyeOpenProbability: 0.89, rightEyeOpenProbability: 0.93 },
  ];
  expect(evaluateLiveness(frames)).toBe(false);
});

test('evaluateLiveness is false with too few frames to detect a blink', () => {
  expect(evaluateLiveness([{ leftEyeOpenProbability: 0.1, rightEyeOpenProbability: 0.1 }])).toBe(false);
});
