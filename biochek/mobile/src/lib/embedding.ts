import type { TensorflowModel } from 'react-native-fast-tflite';
import type { RawPixelData } from 'react-native-nitro-image';

// NOTE ON ARCHITECTURE (Task 13 ruling — see progress.md "Task 13: Ruling"):
// The brief's original design assumed a live VisionCamera frame-processor
// worklet (`useFrameProcessor` + `runOnJS` + a raw `Frame` object), resized
// via `vision-camera-resize-plugin`. That architecture no longer exists:
// Task 12's fix round rewrote FaceCaptureCamera.tsx to use
// react-native-vision-camera-face-detector's own <Camera> wrapper (Nitro-based
// v5/v2 APIs), which owns the camera natively and only exposes
// `onFacesDetected(faces: Face[])` (metadata, not pixel data) plus
// `usePhotoOutput().capturePhotoToFile()` for stills. There is no raw `Frame`
// available in app code, so `vision-camera-resize-plugin` (which only
// operates on live `Frame` objects) cannot be used here.
//
// Instead, `extractEmbedding` runs once per capture, on the *saved photo
// file* produced by `capturePhotoToFile()`. Decoding/resizing that file is
// done with `react-native-nitro-image` (already an installed dependency of
// react-native-vision-camera@5.2.3, which uses it internally for photo
// output) — it loads a JPEG from a filesystem path, resizes it in-memory to
// the model's expected 112x112 input, and exposes the resized pixels via
// `toRawPixelDataAsync()` as a raw `{ buffer, width, height, pixelFormat }`
// struct. See biochek/mobile/assets/models/README.md and the Task 13 report
// for the react-native-fast-tflite v3 API this was grounded against
// (loadTensorflowModel/runSync take/return ArrayBuffer[], not TypedArray[];
// queried live via context7 on 2026-09-17).
//
// NOTE ON DYNAMIC IMPORTS: `react-native-fast-tflite` and
// `react-native-nitro-image` are Nitro-module packages that call
// `TurboModuleRegistry.getEnforcing('NitroModules')` as a side effect of
// being imported, which throws outside a real native binary (e.g. under
// jest-expo, which has no device/simulator backing it). `cosineSimilarity`/
// `isMatch` are pure math and must stay importable and testable under Jest
// with zero native dependency, so the native packages are imported
// dynamically (only inside `loadFaceModel`/`extractEmbedding`, which are
// never called from pure-math tests) instead of at module top-level.

const DEFAULT_THRESHOLD = 0.6;
const MODEL_INPUT_SIZE = 112;

let model: TensorflowModel | null = null;

export async function loadFaceModel(): Promise<void> {
  if (model) return;
  const { loadTensorflowModel } = await import('react-native-fast-tflite');
  model = await loadTensorflowModel(require('../../assets/models/mobilefacenet.tflite'), []);
}

/**
 * Extracts a facial embedding from a captured photo file.
 *
 * @param photoPath Filesystem path to the captured photo (e.g. the
 *   `filePath` returned by `usePhotoOutput().capturePhotoToFile()`). Not a
 *   `file://` URL — react-native-nitro-image's `filePath` loader takes a
 *   plain filesystem path.
 * @returns The embedding vector (dimension determined by the loaded model's
 *   output tensor — 192 for the MobileFaceNet conversion currently bundled
 *   at assets/models/mobilefacenet.tflite; see that folder's README.md),
 *   or `[]` if extraction fails.
 */
export async function extractEmbedding(photoPath: string): Promise<number[]> {
  if (!model) {
    throw new Error('loadFaceModel() must resolve before extractEmbedding() is called');
  }

  const { loadImage } = await import('react-native-nitro-image');
  const image = await loadImage({ filePath: photoPath });
  const resized = await image.resizeAsync(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const raw = await resized.toRawPixelDataAsync();

  const inputTensor = model.inputs[0];
  if (!inputTensor) {
    throw new Error('loaded model exposes no input tensor');
  }

  const inputBuffer = rawPixelDataToInputBuffer(raw, inputTensor.dataType);
  const outputs = model.runSync([inputBuffer]);
  return Array.from(new Float32Array(outputs[0]));
}

/**
 * Converts nitro-image's raw pixel buffer (RGBA/BGRA/RGB/etc, uint8, literal
 * byte order given by `pixelFormat`) into the flat RGB tensor buffer the
 * model expects, normalized according to the input tensor's declared
 * `dataType` ('uint8' for quantized models, 'float32' for float models —
 * scaled to [-1, 1], the standard MobileFaceNet preprocessing).
 */
function rawPixelDataToInputBuffer(raw: RawPixelData, dataType: string): ArrayBuffer {
  const src = new Uint8Array(raw.buffer);
  const channels = raw.pixelFormat.length; // e.g. 'RGBA' -> 4, 'RGB' -> 3
  const pixelCount = raw.width * raw.height;
  const { rOffset, gOffset, bOffset } = channelOffsets(raw.pixelFormat);

  if (dataType === 'uint8') {
    const out = new Uint8Array(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
      const srcIdx = i * channels;
      out[i * 3] = src[srcIdx + rOffset];
      out[i * 3 + 1] = src[srcIdx + gOffset];
      out[i * 3 + 2] = src[srcIdx + bOffset];
    }
    return out.buffer;
  }

  // float32: normalize to [-1, 1] via (pixel - 128) / 128 — the exact
  // preprocessing used by the reference MobileFaceNet TFLite conversion
  // this app bundles (see assets/models/README.md for the source).
  const out = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * channels;
    out[i * 3] = (src[srcIdx + rOffset] - 128) / 128;
    out[i * 3 + 1] = (src[srcIdx + gOffset] - 128) / 128;
    out[i * 3 + 2] = (src[srcIdx + bOffset] - 128) / 128;
  }
  return out.buffer;
}

function channelOffsets(pixelFormat: string): { rOffset: number; gOffset: number; bOffset: number } {
  switch (pixelFormat) {
    case 'RGBA':
    case 'RGBX':
    case 'RGB':
      return { rOffset: 0, gOffset: 1, bOffset: 2 };
    case 'BGRA':
    case 'BGRX':
    case 'BGR':
      return { rOffset: 2, gOffset: 1, bOffset: 0 };
    case 'ARGB':
    case 'XRGB':
      return { rOffset: 1, gOffset: 2, bOffset: 3 };
    case 'ABGR':
    case 'XBGR':
      return { rOffset: 3, gOffset: 2, bOffset: 1 };
    default:
      // Unknown format: assume RGB-first layout as a best-effort fallback.
      return { rOffset: 0, gOffset: 1, bOffset: 2 };
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('vector length mismatch');
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isMatch(a: number[], b: number[], threshold = DEFAULT_THRESHOLD): boolean {
  return cosineSimilarity(a, b) >= threshold;
}
