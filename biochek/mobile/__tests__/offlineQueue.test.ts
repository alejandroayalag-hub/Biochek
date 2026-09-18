import * as SecureStore from 'expo-secure-store';
import { enqueueChecada, flushQueue } from '../src/lib/offlineQueue';
import { apiClient } from '../src/api/client';

jest.mock('expo-secure-store');
jest.mock('../src/api/client');
jest.mock('../src/auth/session', () => ({ getToken: () => Promise.resolve('fake-token') }));

const payload = {
  tipo: 'entrada' as const,
  embedding: [0.1, 0.2],
  lat: 20.6,
  lng: -103.3,
  timestamp_dispositivo: '2026-09-17T10:00:00.000Z',
  selfie_base64: 'ZmFrZQ==',
};

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(store[key] ?? null));
  (SecureStore.setItemAsync as jest.Mock).mockImplementation((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  });
  (apiClient.post as jest.Mock).mockReset();
});

test('enqueueChecada persists the payload for later retry', async () => {
  await enqueueChecada(payload);
  const raw = store['biochek_checada_queue'];
  expect(JSON.parse(raw)).toEqual([payload]);
});

test('flushQueue sends every queued item and empties the queue on success', async () => {
  await enqueueChecada(payload);
  (apiClient.post as jest.Mock).mockResolvedValue({});

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: true, remaining: 0 });
  expect(apiClient.post).toHaveBeenCalledWith('/api/mobile/checadas', payload, 'fake-token');
  expect(JSON.parse(store['biochek_checada_queue'])).toEqual([]);
});

test('flushQueue keeps an item queued if sending it fails', async () => {
  await enqueueChecada(payload);
  (apiClient.post as jest.Mock).mockRejectedValue(new TypeError('network error'));

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: false, remaining: 1 });
});
