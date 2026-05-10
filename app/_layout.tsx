import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#1a73e8',
        headerTitleStyle: { color: '#202124' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Nanolog' }} />
      <Stack.Screen name="sheet/[title]" options={{ headerBackTitle: 'Back' }} />
    </Stack>
  );
}
