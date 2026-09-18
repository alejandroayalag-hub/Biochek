import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

type Props = { onApproved: () => void };

const POLL_INTERVAL_MS = 15000;

export function EnrollmentPendingScreen({ onApproved }: Props) {
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const token = await getToken();
      const result = await apiClient.get<{ estado: string | null }>(
        '/api/mobile/enrolamiento/estado',
        token ?? undefined
      );
      if (cancelled) return;
      setEstado(result.estado);
      if (result.estado === 'aprobado') {
        onApproved();
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [onApproved]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>
        {estado === 'rechazado'
          ? 'Tu enrolamiento fue rechazado. Contacta a RH para volver a intentarlo.'
          : 'Esperando aprobación de RH para tu enrolamiento facial...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { textAlign: 'center', fontSize: 16 },
});
