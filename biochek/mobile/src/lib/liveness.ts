export type EyeOpenSample = {
  leftEyeOpenProbability: number;
  rightEyeOpenProbability: number;
};

const OPEN_THRESHOLD = 0.6;
const CLOSED_THRESHOLD = 0.3;

function avgOpen(sample: EyeOpenSample): number {
  return (sample.leftEyeOpenProbability + sample.rightEyeOpenProbability) / 2;
}

// A blink = at least one frame clearly open, followed by at least one
// frame clearly closed, followed by at least one frame clearly open again.
export function evaluateLiveness(frames: EyeOpenSample[]): boolean {
  if (frames.length < 3) return false;

  let sawOpen = false;
  let sawClosedAfterOpen = false;

  for (const frame of frames) {
    const open = avgOpen(frame);
    if (!sawOpen && open >= OPEN_THRESHOLD) {
      sawOpen = true;
    } else if (sawOpen && !sawClosedAfterOpen && open <= CLOSED_THRESHOLD) {
      sawClosedAfterOpen = true;
    } else if (sawClosedAfterOpen && open >= OPEN_THRESHOLD) {
      return true;
    }
  }
  return false;
}
