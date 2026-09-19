import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { apiClient } from '../api/client';

type Aviso = { version: string; texto: string };
type Props = { onAccepted: (avisoVersion: string) => void };

export function PrivacyConsentScreen({ onAccepted }: Props) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<Aviso>('/api/aviso-privacidad')
      .then(setAviso)
      .catch(err => setError(err instanceof Error ? err.message : 'error al cargar el aviso de privacidad'));
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (!aviso) {
    return (
      <View style={styles.center}>
        <Text>Cargando aviso de privacidad...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll}>
        <Text style={styles.texto}>{aviso.texto}</Text>
      </ScrollView>
      <Pressable style={styles.checkboxRow} onPress={() => setChecked(prev => !prev)}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]} />
        <Text>Acepto el aviso de privacidad</Text>
      </Pressable>
      <Pressable
        style={[styles.button, !checked && styles.buttonDisabled]}
        disabled={!checked}
        onPress={() => onAccepted(aviso.version)}
      >
        <Text style={styles.buttonText}>Continuar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, marginBottom: 16 },
  texto: { fontSize: 14, lineHeight: 20 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: '#333', marginRight: 8 },
  checkboxChecked: { backgroundColor: '#333' },
  button: { backgroundColor: '#1e3a8a', padding: 14, borderRadius: 6, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#9ca3af' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  error: { color: 'red', textAlign: 'center', padding: 8 },
});
