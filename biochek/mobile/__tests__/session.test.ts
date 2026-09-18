import * as SecureStore from 'expo-secure-store';
import { saveToken, getToken, clearToken, saveEnrolledEmbedding, getEnrolledEmbedding } from '../src/auth/session';

jest.mock('expo-secure-store');

test('saveToken then getToken round-trips the value', async () => {
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('abc.def.ghi');

  await saveToken('abc.def.ghi');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('biochek_empleado_token', 'abc.def.ghi');
  await expect(getToken()).resolves.toBe('abc.def.ghi');
});

test('clearToken deletes the stored key', async () => {
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  await clearToken();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('biochek_empleado_token');
});

test('saveEnrolledEmbedding then getEnrolledEmbedding round-trips the vector', async () => {
  const store: Record<string, string> = {};
  (SecureStore.setItemAsync as jest.Mock).mockImplementation((k: string, v: string) => { store[k] = v; return Promise.resolve(); });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((k: string) => Promise.resolve(store[k] ?? null));

  await saveEnrolledEmbedding([0.1, 0.2, 0.3]);
  await expect(getEnrolledEmbedding()).resolves.toEqual([0.1, 0.2, 0.3]);
});

test('getEnrolledEmbedding returns null when nothing was cached', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  await expect(getEnrolledEmbedding()).resolves.toBeNull();
});

test('getEnrolledEmbedding returns null on a corrupted cached value instead of throwing', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{not json');
  await expect(getEnrolledEmbedding()).resolves.toBeNull();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
