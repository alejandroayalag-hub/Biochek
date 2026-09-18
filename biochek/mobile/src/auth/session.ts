import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'biochek_empleado_token';

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

const EMBEDDING_KEY = 'biochek_enrolled_embedding';

export async function saveEnrolledEmbedding(embedding: number[]): Promise<void> {
  await SecureStore.setItemAsync(EMBEDDING_KEY, JSON.stringify(embedding));
}

export async function getEnrolledEmbedding(): Promise<number[] | null> {
  const raw = await SecureStore.getItemAsync(EMBEDDING_KEY);
  return raw ? JSON.parse(raw) : null;
}
