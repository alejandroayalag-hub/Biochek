import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FaceCaptureCamera, type CaptureResult } from '../components/FaceCaptureCamera';
import { apiClient } from '../api/client';
import { getToken, saveEnrolledEmbedding } from '../auth/session';

const REQUIRED_SHOTS = [
  'Mira de frente a la cámara',
  'Gira ligeramente tu rostro a la izquierda',
  'Gira ligeramente tu rostro a la derecha',
];

type Props = { onSubmitted: () => void };

export function EnrollmentWizardScreen({ onSubmitted }: Props) {
  const [shotIndex, setShotIndex] = useState(0);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCapture(result: CaptureResult) {
    if (!result.liveness) {
      setError('No se detectó parpadeo — inténtalo de nuevo.');
      return;
    }
    setError(null);
    const next = [...captures, result];
    setCaptures(next);

    if (shotIndex + 1 < REQUIRED_SHOTS.length) {
      setShotIndex(shotIndex + 1);
      return;
    }
    await submitEnrollment(next);
  }

  async function submitEnrollment(allCaptures: CaptureResult[]) {
    setSubmitting(true);
    try {
      const token = await getToken();
      await apiClient.post(
        '/api/mobile/enrolamientos',
        {
          embedding: allCaptures[0].embedding,
          fotos_base64: allCaptures.map(c => c.photoBase64),
          aviso_privacidad_aceptado: true,
        },
        token ?? undefined
      );
      await saveEnrolledEmbedding(allCaptures[0].embedding);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al enviar enrolamiento');
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <View style={styles.center}>
        <Text>Enviando enrolamiento...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FaceCaptureCamera instruction={REQUIRED_SHOTS[shotIndex]} onCapture={handleCapture} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: 'red', textAlign: 'center', padding: 8 },
});
