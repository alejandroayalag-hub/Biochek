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
};

async function readQueue(): Promise<ChecadaPayload[]> {
  const raw = await SecureStore.getItemAsync(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeQueue(queue: ChecadaPayload[]): Promise<void> {
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueChecada(payload: ChecadaPayload): Promise<void> {
  const queue = await readQueue();
  queue.push(payload);
  await writeQueue(queue);
}

export async function flushQueue(): Promise<{ sentAny: boolean; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { sentAny: false, remaining: 0 };

  const token = await getToken();
  const stillQueued: ChecadaPayload[] = [];
  let sentAny = false;

  for (const payload of queue) {
    try {
      await apiClient.post('/api/mobile/checadas', payload, token ?? undefined);
      sentAny = true;
    } catch {
      stillQueued.push(payload);
    }
  }

  await writeQueue(stillQueued);
  return { sentAny, remaining: stillQueued.length };
}
