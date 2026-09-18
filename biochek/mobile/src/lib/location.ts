import * as Location from 'expo-location';

export async function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('permiso de ubicación denegado');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}
