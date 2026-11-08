import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import { colors } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="light" />
      <HomeScreen />
    </SafeAreaProvider>
  );
}
