import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { getAccessToken } from '@/src/lib/auth';
import { listSheets } from '@/src/lib/sheets';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; sheets: string[] };

export default function HomeScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = async () => {
    setState({ status: 'loading' });
    try {
      const token = await getAccessToken();
      const sheets = await listSheets(token);
      setState({ status: 'loaded', sheets });
    } catch (e: any) {
      setState({ status: 'error', message: e.message ?? 'Failed to load sheets' });
    }
  };

  useEffect(() => { load(); }, []);

  if (state.status === 'loading') {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1a73e8" /></View>;
  }

  if (state.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{state.message}</Text>
        <TouchableOpacity onPress={load} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={state.sheets}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/sheet/${encodeURIComponent(item)}`)}
            activeOpacity={0.7}
          >
            <Text style={styles.rowText}>{item}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  rowText: {
    flex: 1,
    fontSize: 17,
    color: '#202124',
  },
  chevron: {
    fontSize: 22,
    color: '#bbb',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e0e0e0',
    marginLeft: 16,
  },
  errorText: {
    fontSize: 15,
    color: '#d93025',
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#1a73e8',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
