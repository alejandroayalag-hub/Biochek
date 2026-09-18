import { useCallback, useRef, useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { Camera } from 'react-native-vision-camera-face-detector';
import type { Face } from 'react-native-vision-camera-face-detector';
import { evaluateLiveness, type EyeOpenSample } from '../lib/liveness';

export type CaptureResult = {
  photoBase64: string;
  faceDetected: boolean;
  liveness: boolean;
};

type Props = {
  instruction: string;
  onCapture: (result: CaptureResult) => void;
};

const SAMPLE_WINDOW_SIZE = 15;

// NOTE: react-native-vision-camera@5.x and react-native-vision-camera-face-detector@2.x
// are a Nitro-based rewrite of both libraries. There is no more `useFrameProcessor`/
// `frameProcessor` prop, and the `<Camera>` component no longer has a `photo` prop —
// photo capture now goes through a `CameraOutput` created by `usePhotoOutput()` and
// attached via the `outputs` prop. Face detection is likewise now a `CameraOutput`
// under the hood; this package's own `<Camera>` wrapper runs it natively and reports
// results back to JS via a plain `onFacesDetected` callback (no worklet/frame-processor
// needed for this use case). See task-12-report.md "Fix round 1" for the docs this was
// grounded in.
export function FaceCaptureCamera({ instruction, onCapture }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const photoOutput = usePhotoOutput();
  const samples = useRef<EyeOpenSample[]>([]);
  const [faceDetected, setFaceDetected] = useState(false);

  const pushSample = useCallback((sample: EyeOpenSample, detected: boolean) => {
    samples.current = [...samples.current, sample].slice(-SAMPLE_WINDOW_SIZE);
    setFaceDetected(detected);
  }, []);

  const onFacesDetected = useCallback(
    (faces: Face[]) => {
      if (faces.length > 0) {
        const face = faces[0];
        // Eye-open probabilities are only populated when classification runs
        // and are typed as optional; treat a missing reading as "not open".
        pushSample(
          {
            leftEyeOpenProbability: face.leftEyeOpenProbability ?? 0,
            rightEyeOpenProbability: face.rightEyeOpenProbability ?? 0,
          },
          true
        );
      } else {
        pushSample({ leftEyeOpenProbability: 0, rightEyeOpenProbability: 0 }, false);
      }
    },
    [pushSample]
  );

  const onFaceDetectionError = useCallback((error: Error) => {
    console.warn('BioChek: face detection error', error);
  }, []);

  async function handleCapture() {
    const photoFile = await photoOutput.capturePhotoToFile({}, {});
    const liveness = evaluateLiveness(samples.current);
    onCapture({ photoBase64: photoFile.filePath, faceDetected, liveness });
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text>BioChek necesita acceso a la cámara.</Text>
        <Button title="Permitir cámara" onPress={requestPermission} />
      </View>
    );
  }
  if (!device) {
    return <View style={styles.center}><Text>No se encontró cámara frontal.</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={[photoOutput]}
        runClassifications
        onFacesDetected={onFacesDetected}
        onError={onFaceDetectionError}
      />
      <View style={styles.overlay}>
        <Text style={styles.instruction}>{instruction}</Text>
        <Text style={styles.status}>{faceDetected ? 'Rostro detectado' : 'Centra tu rostro'}</Text>
        <Button title="Capturar" onPress={handleCapture} disabled={!faceDetected} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  overlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 8 },
  instruction: { color: 'white', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 8 },
  status: { color: 'white', fontSize: 14 },
});
