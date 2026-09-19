import { Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/LoginScreen';
import { PrivacyConsentScreen } from '../screens/PrivacyConsentScreen';
import { EnrollmentWizardScreen } from '../screens/EnrollmentWizardScreen';
import { EnrollmentPendingScreen } from '../screens/EnrollmentPendingScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

export type RootStackParamList = {
  Login: undefined;
  PrivacyConsent: undefined;
  EnrollmentWizard: { avisoVersion: string };
  EnrollmentPending: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" children={({ navigation }) => (
          <LoginScreen onLoggedIn={async () => {
            // LoginScreen calls onLoggedIn() without awaiting it, so anything
            // that rejects here would be an unhandled rejection: no error
            // shown, no navigation, the screen just sits there looking idle.
            // Catch it and tell the user, leaving them on Login so they can
            // simply press "Entrar" again once they have connectivity.
            try {
              const token = await getToken();
              const { estado } = await apiClient.get<{ estado: string | null }>(
                '/api/mobile/enrolamiento/estado',
                token ?? undefined
              );
              if (estado === 'aprobado') navigation.replace('Home');
              else if (estado === null) navigation.replace('PrivacyConsent');
              else navigation.replace('EnrollmentPending');
            } catch (err) {
              console.warn('BioChek: no se pudo consultar el estado de enrolamiento', err);
              Alert.alert(
                'BioChek',
                'No se pudo verificar tu enrolamiento. Revisa tu conexión e inténtalo de nuevo.'
              );
            }
          }} />
        )} />
        <Stack.Screen name="PrivacyConsent" children={({ navigation }) => (
          <PrivacyConsentScreen onAccepted={(avisoVersion) => navigation.replace('EnrollmentWizard', { avisoVersion })} />
        )} />
        <Stack.Screen name="EnrollmentWizard" children={({ navigation, route }) => (
          <EnrollmentWizardScreen
            avisoVersion={route.params.avisoVersion}
            onSubmitted={() => navigation.replace('EnrollmentPending')}
          />
        )} />
        <Stack.Screen name="EnrollmentPending" children={({ navigation }) => (
          <EnrollmentPendingScreen onApproved={() => navigation.replace('Home')} />
        )} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerBackVisible: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
