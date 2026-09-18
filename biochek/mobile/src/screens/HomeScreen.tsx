import { useEffect, useState } from 'react';
import { View, Text, Button, FlatList, StyleSheet } from 'react-native';
import { FaceCaptureCamera, type CaptureResult } from '../components/FaceCaptureCamera';
import { getCurrentLocation } from '../lib/location';
import { isMatch } from '../lib/embedding';
import { apiClient } from '../api/client';
import { getToken, getEnrolledEmbedding } from '../auth/session';
import { enqueueChecada, flushQueue } from '../lib/offlineQueue';

type Checada = { id: number; tipo: 'entrada' | 'salida'; timestamp: string };

export function HomeScreen() {
  const [capturing, setCapturing] = useState(false);
  const [history, setHistory] = useState<Checada[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const nextTipo: 'entrada' | 'salida' =
    history[0]?.tipo === 'entrada' ? 'salida' : 'entrada';

  async function loadHistory() {
    const token = await getToken();
    const rows = await apiClient.get<Checada[]>('/api/mobile/checadas', token ?? undefined);
    setHistory(rows);
  }

  useEffect(() => {
    loadHistory();
    const interval = setInterval(async () => {
      const flushed = await flushQueue();
      setPendingCount(flushed.remaining);
      if (flushed.sentAny) loadHistory();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  async function handleCapture(result: CaptureResult) {
    setCapturing(false);
    if (!result.liveness) {
      setStatus('No se detectó parpadeo — inténtalo de nuevo.');
      return;
    }

    const enrolledEmbedding = await getEnrolledEmbedding();
    if (enrolledEmbedding && !isMatch(result.embedding, enrolledEmbedding)) {
      setStatus('No coincide tu rostro — inténtalo de nuevo.');
      return; // instant local feedback, no network round trip; backend still re-checks on submit
    }

    setStatus('Verificando...');
    try {
      const location = await getCurrentLocation();
      const token = await getToken();
      const payload = {
        tipo: nextTipo,
        embedding: result.embedding,
        lat: location.lat,
        lng: location.lng,
        timestamp_dispositivo: new Date().toISOString(),
        selfie_base64: result.photoBase64,
      };

      try {
        await apiClient.post('/api/mobile/checadas', payload, token ?? undefined);
        setStatus(`Checada de ${nextTipo} registrada.`);
        loadHistory();
      } catch (err) {
        // network failure -> queue; a 4xx from the server is a real rejection, not queued
        if (err instanceof TypeError) {
          await enqueueChecada(payload);
          setPendingCount(c => c + 1);
          setStatus('Sin conexión — checada guardada, pendiente de sincronizar.');
        } else {
          throw err;
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'error al checar');
    }
  }

  if (capturing) {
    return (
      <FaceCaptureCamera
        instruction={`Verificando para ${nextTipo}`}
        onCapture={handleCapture}
      />
    );
  }

  return (
    <View style={styles.container}>
      {pendingCount > 0 && <Text style={styles.badge}>{pendingCount} pendientes de sincronizar</Text>}
      {status && <Text style={styles.status}>{status}</Text>}
      <Button title={`Checar ${nextTipo}`} onPress={() => setCapturing(true)} />
      <FlatList
        data={history}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Text style={styles.historyRow}>{item.tipo} — {new Date(item.timestamp).toLocaleString()}</Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  badge: { backgroundColor: '#ffcc00', padding: 8, borderRadius: 8, textAlign: 'center' },
  status: { textAlign: 'center' },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
