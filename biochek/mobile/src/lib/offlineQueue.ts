import * as SecureStore from 'expo-secure-store';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

const QUEUE_KEY = 'biochek_checada_queue';

export type ChecadaPayload = {
  tipo: 'entrada' | 'salida';
  embedding: number[];
  lat: number;
  lng: number;
  timestamp_dispositivo: string;
  selfie_base64: string;
  /**
   * Set by `flushQueue` on every retry: tells the backend this checada was
   * captured while offline and is being submitted late, so it applies the
   * wider `OFFLINE_TIMESTAMP_DRIFT_THRESHOLD_MS` clock-drift window instead
   * of the tight live-submission one. Live submissions (HomeScreen) never
   * set it, so the normal anti-replay check still applies to them.
   */
  enviado_diferido?: boolean;
};

export type FlushResult = {
  sentAny: boolean;
  remaining: number;
  /** Items permanently rejected by the server and dropped from the queue. */
  droppedCount: number;
};

async function readQueue(): Promise<ChecadaPayload[]> {
  const raw = await SecureStore.getItemAsync(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    // A corrupted/truncated SecureStore value must not throw on every read —
    // degrade to "nothing queued", the same as an empty store.
    console.warn('BioChek: checada queue is corrupted, discarding it', error);
    return [];
  }
}

async function writeQueue(queue: ChecadaPayload[]): Promise<void> {
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueChecada(payload: ChecadaPayload): Promise<void> {
  const queue = await readQueue();
  queue.push(payload);
  await writeQueue(queue);
}

export async function flushQueue(): Promise<FlushResult> {
  const queue = await readQueue();
  if (queue.length === 0) return { sentAny: false, remaining: 0, droppedCount: 0 };

  const token = await getToken();
  const stillQueued: ChecadaPayload[] = [];
  let sentAny = false;
  let droppedCount = 0;

  for (const payload of queue) {
    // Always flag a retry as deferred: by definition it is being sent after
    // the moment it was captured.
    const retryPayload: ChecadaPayload = { ...payload, enviado_diferido: true };
    try {
      await apiClient.post('/api/mobile/checadas', retryPayload, token ?? undefined);
      sentAny = true;
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch() itself failed: still offline (or the host is unreachable).
        // Keep the item — this is exactly what the queue is for. Same
        // network-vs-rejection discrimination as HomeScreen's live path.
        stillQueued.push(payload);
      } else {
        // A real server rejection (4xx/5xx body turned into an Error by
        // apiClient). Retrying it forever would never succeed and would keep
        // the "pendientes de sincronizar" badge stuck for good, so drop it —
        // loudly. There is no error-reporting backend in this plan, so a
        // console.warn with the full context is the best available trace;
        // the server side also writes an audit_log row for geofence and
        // clock-drift rejections.
        droppedCount += 1;
        console.warn(
          'BioChek: descartando checada en cola rechazada por el servidor',
          {
            tipo: payload.tipo,
            timestamp_dispositivo: payload.timestamp_dispositivo,
            lat: payload.lat,
            lng: payload.lng,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }
    }
  }

  await writeQueue(stillQueued);
  return { sentAny, remaining: stillQueued.length, droppedCount };
}
