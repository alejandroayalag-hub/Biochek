# mobilefacenet.tflite

## What this is

A pretrained MobileFaceNet face-embedding model in TensorFlow Lite format,
used by `src/lib/embedding.ts` (`loadFaceModel()`/`extractEmbedding()`) to
compute an on-device facial embedding from a captured photo.

- **Input**: `[1, 112, 112, 3]`, `float32`, RGB, normalized as
  `(pixel - 128) / 128` (range `[-1, 1]`).
- **Output**: `[1, 192]`, `float32` — a 192-dimension embedding vector.
  (Not 128-dim, despite "128-dim" being the commonly-cited MobileFaceNet
  figure for other conversions — this specific conversion's output layer is
  192-wide. `extractEmbedding()` in `embedding.ts` does not hardcode a
  dimension; it returns whatever length the loaded model produces, and the
  backend's `isMatch`/`cosineSimilarity` in `embedding.js` are
  dimension-agnostic too, so this is not a bug — just document it correctly
  wherever the dimension is mentioned.)

## Exact source

Downloaded from:

```
https://raw.githubusercontent.com/MCarlomagno/FaceRecognitionAuth/master/assets/mobilefacenet.tflite
```

(commit: `master` branch as of 2026-09-17; repo:
https://github.com/MCarlomagno/FaceRecognitionAuth)

- File size: 5,233,552 bytes
- SHA-256: `be4bc7cfc53f7bc336d0f28b1ab92535f618c913a422b683210750f6b5354854`
- Verified as a genuine TensorFlow Lite FlatBuffer (magic bytes `TFL3` at
  offset 4) before being committed here — not a placeholder or fabricated
  file.

The preprocessing formula and output shape above were cross-checked against
that repo's own inference code
(`lib/services/ml_service.dart`, `imageToByteListFloat32()` and
`setCurrentPrediction()`), which resizes/crops to 112x112, normalizes with
`(pixel - 128) / 128`, and reads a `[1, 192]` output tensor from this exact
file.

## License — ⚠️ needs legal/compliance review before shipping to the client

The hosting repository (`MCarlomagno/FaceRecognitionAuth`) is licensed
**BSD 3-Clause** (see its `LICENSE` file /
https://opensource.org/licenses/BSD-3-Clause), which covers that repo's own
source code. **That repo's README and license do not state where the
`mobilefacenet.tflite` weights themselves originally came from, nor do they
make an explicit licensing claim over the model weights specifically** —
this file is a widely-circulated, unofficial TFLite conversion of the
MobileFaceNet architecture (Chen et al., "MobileFaceNets: Efficient CNNs for
Accurate Real-Time Face Verification on Mobile Devices", 2018) that shows up
verbatim, byte-for-byte, across numerous public face-recognition tutorial
repos (Flutter/Android/iOS), none of which appear to be the original
publisher of the trained weights. The original MobileFaceNet reference
implementations (e.g. `sirius-ai/MobileFaceNet_TF`) were trained on
MS-Celeb-1M-derived data, a dataset with a well-documented, unresolved
provenance/consent controversy (Microsoft took down the original dataset in
2019), which is a separate concern from code licensing.

**Before this file ships inside a client-distributed app, a human must:**

1. Confirm whether BioChek's contract/license terms allow bundling a
   third-party model of unclear original provenance, or
2. Replace it with a model that has an unambiguous, documented commercial
   license (e.g. train/convert one in-house from a licensed dataset, or
   source a conversion from a publisher that explicitly licenses the
   weights, not just the surrounding demo-app code).

This was flagged rather than silently shipped. See Task 13's report
(`.superpowers/sdd/2026-09-17-biochek-mobile/task-13-report.md`) for the
full context of this decision.
