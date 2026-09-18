import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text } from 'react-native';
import { LoginScreen } from '../screens/LoginScreen';

export type RootStackParamList = {
  Login: undefined;
  EnrollmentWizard: undefined;
  EnrollmentPending: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function PlaceholderScreen({ name }: { name: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{name} — pending implementation</Text>
    </View>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" children={({ navigation }) => (
          <LoginScreen onLoggedIn={() => navigation.replace('EnrollmentPending')} />
        )} />
        <Stack.Screen name="EnrollmentWizard" children={() => <PlaceholderScreen name="EnrollmentWizard" />} />
        <Stack.Screen name="EnrollmentPending" children={() => <PlaceholderScreen name="EnrollmentPending" />} />
        <Stack.Screen name="Home" children={() => <PlaceholderScreen name="Home" />} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
