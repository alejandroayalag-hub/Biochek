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

  expect(result).toEqual({ sentAny: true, remaining: 0, droppedCount: 0 });
  // A retry is always flagged as deferred so the backend applies its wider
  // offline clock-drift window instead of permanently 422-ing the item.
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mobile/checadas',
    { ...payload, enviado_diferido: true },
    'fake-token'
  );
  expect(JSON.parse(store['biochek_checada_queue'])).toEqual([]);
});

test('flushQueue keeps an item queued if the network is unavailable', async () => {
  await enqueueChecada(payload);
  (apiClient.post as jest.Mock).mockRejectedValue(new TypeError('network error'));

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: false, remaining: 1, droppedCount: 0 });
  // Re-queued without the deferred flag: it is re-added on the next attempt.
  expect(JSON.parse(store['biochek_checada_queue'])).toEqual([payload]);
});

test('flushQueue drops an item the server really rejected instead of retrying it forever', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await enqueueChecada(payload);
  // Not a TypeError: apiClient turns a 4xx body into a plain Error. Retrying
  // this forever would never succeed and would wedge the pending badge.
  (apiClient.post as jest.Mock).mockRejectedValue(new Error('fuera de geocerca'));

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: false, remaining: 0, droppedCount: 1 });
  expect(JSON.parse(store['biochek_checada_queue'])).toEqual([]);
  expect(warn).toHaveBeenCalled();

  // And it stays gone: a second flush has nothing left to send.
  (apiClient.post as jest.Mock).mockClear();
  const second = await flushQueue();
  expect(second).toEqual({ sentAny: false, remaining: 0, droppedCount: 0 });
  expect(apiClient.post).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('flushQueue drops only the rejected item and keeps the network-failed one', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const other = { ...payload, tipo: 'salida' as const };
  await enqueueChecada(payload);
  await enqueueChecada(other);
  (apiClient.post as jest.Mock)
    .mockRejectedValueOnce(new Error('hora del dispositivo fuera de rango'))
    .mockRejectedValueOnce(new TypeError('network error'));

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: false, remaining: 1, droppedCount: 1 });
  expect(JSON.parse(store['biochek_checada_queue'])).toEqual([other]);
  warn.mockRestore();
});

test('flushQueue treats a corrupted stored queue as empty instead of throwing', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  store['biochek_checada_queue'] = '{not json';

  await expect(flushQueue()).resolves.toEqual({ sentAny: false, remaining: 0, droppedCount: 0 });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
