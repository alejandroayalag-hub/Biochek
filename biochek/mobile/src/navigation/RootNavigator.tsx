import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/LoginScreen';
import { EnrollmentWizardScreen } from '../screens/EnrollmentWizardScreen';
import { EnrollmentPendingScreen } from '../screens/EnrollmentPendingScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

export type RootStackParamList = {
  Login: undefined;
  EnrollmentWizard: undefined;
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
            const token = await getToken();
            const { estado } = await apiClient.get<{ estado: string | null }>(
              '/api/mobile/enrolamiento/estado',
              token ?? undefined
            );
            if (estado === 'aprobado') navigation.replace('Home');
            else if (estado === null) navigation.replace('EnrollmentWizard');
            else navigation.replace('EnrollmentPending');
          }} />
        )} />
        <Stack.Screen name="EnrollmentWizard" children={({ navigation }) => (
          <EnrollmentWizardScreen onSubmitted={() => navigation.replace('EnrollmentPending')} />
        )} />
        <Stack.Screen name="EnrollmentPending" children={({ navigation }) => (
          <EnrollmentPendingScreen onApproved={() => navigation.replace('Home')} />
        )} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerBackVisible: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
