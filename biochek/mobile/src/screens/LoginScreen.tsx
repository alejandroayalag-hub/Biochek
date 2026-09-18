import { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { saveToken } from '../auth/session';

type Props = { onLoggedIn: () => void };

export function LoginScreen({ onLoggedIn }: Props) {
  const [codigoNoi, setCodigoNoi] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const { token } = await apiClient.post<{ token: string }>('/api/auth/empleado/login', {
        codigo_noi: codigoNoi,
        pin,
      });
      await saveToken(token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BioChek</Text>
      <TextInput
        style={styles.input}
        placeholder="Código de empleado"
        autoCapitalize="characters"
        value={codigoNoi}
        onChangeText={setCodigoNoi}
      />
      <TextInput
        style={styles.input}
        placeholder="PIN"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        value={pin}
        onChangeText={setPin}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={loading ? 'Entrando...' : 'Entrar'} onPress={handleLogin} disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: 'red', textAlign: 'center' },
});
