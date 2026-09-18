import { useCallback, useRef, useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-reanimated';
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

export function FaceCaptureCamera({ instruction, onCapture }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const camera = useRef<Camera>(null);
  const { detectFaces } = useFaceDetector();
  const samples = useRef<EyeOpenSample[]>([]);
  const [faceDetected, setFaceDetected] = useState(false);

  const onFaceSample = useCallback((sample: EyeOpenSample, detected: boolean) => {
    samples.current = [...samples.current, sample].slice(-SAMPLE_WINDOW_SIZE);
    setFaceDetected(detected);
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    if (faces.length > 0) {
      const face = faces[0];
      runOnJS(onFaceSample)(
        { leftEyeOpenProbability: face.leftEyeOpenProbability, rightEyeOpenProbability: face.rightEyeOpenProbability },
        true
      );
    } else {
      runOnJS(onFaceSample)({ leftEyeOpenProbability: 0, rightEyeOpenProbability: 0 }, false);
    }
  }, [onFaceSample]);

  async function handleCapture() {
    if (!camera.current) return;
    const photo = await camera.current.takePhoto();
    const liveness = evaluateLiveness(samples.current);
    onCapture({ photoBase64: photo.path, faceDetected, liveness });
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
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
        frameProcessor={frameProcessor}
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
