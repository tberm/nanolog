import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import { getAccessToken } from '@/src/lib/auth';
import { appendRow, fetchMetadata } from '@/src/lib/sheets';

// --- Types ---

type ColumnType =
  | { kind: 'text' }
  | { kind: 'float' }
  | { kind: 'integer' }
  | { kind: 'date' }
  | { kind: 'enum'; options: string[] };

interface Column {
  name: string;
  type: ColumnType;
  required: boolean;
}

type MetaState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; columns: Column[] };

type SubmitState = 'idle' | 'submitting' | 'success' | { error: string };

// --- Helpers ---

function parseColumnType(raw: string): ColumnType {
  if (raw.startsWith('enum:')) {
    const options = raw.slice(5).split('|').filter(Boolean);
    return { kind: 'enum', options };
  }
  switch (raw.trim().toLowerCase()) {
    case 'date': return { kind: 'date' };
    case 'float': return { kind: 'float' };
    case 'integer': return { kind: 'integer' };
    default: return { kind: 'text' };
  }
}

function parseRequired(raw: string): boolean {
  return raw.trim().toUpperCase() === 'TRUE';
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initialValue(type: ColumnType): string {
  if (type.kind === 'date') return formatDate(new Date());
  if (type.kind === 'enum') return type.options[0] ?? '';
  return '';
}

function validateField(value: string, type: ColumnType, required: boolean): string | null {
  if (required && value.trim() === '') return 'Required';
  if (type.kind === 'integer' && value.trim() !== '' && !/^-?\d+$/.test(value.trim())) {
    return 'Must be a whole number';
  }
  return null;
}

function parseColumns(rows: string[][]): Column[] {
  const [names, types, requiredFlags] = rows;
  return names.map((name, i) => ({
    name,
    type: parseColumnType(types[i] ?? 'text'),
    required: parseRequired(requiredFlags[i] ?? ''),
  }));
}

// --- Field components ---

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  const dateValue = useMemo(() => {
    const parts = value.split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }, [value]);

  const handleChange = (_: DateTimePickerEvent, selected?: Date) => {
    setShowAndroidPicker(false);
    if (selected) onChange(formatDate(selected));
  };

  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        value={dateValue}
        mode="date"
        display="compact"
        onChange={handleChange}
        style={styles.datePicker}
      />
    );
  }

  return (
    <View>
      <TouchableOpacity onPress={() => setShowAndroidPicker(true)} style={styles.androidDateButton}>
        <Text style={styles.androidDateText}>{value}</Text>
      </TouchableOpacity>
      {showAndroidPicker && (
        <DateTimePicker value={dateValue} mode="date" onChange={handleChange} />
      )}
    </View>
  );
}

function EnumField({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.pickerWrapper}>
      <Picker selectedValue={value} onValueChange={onChange} style={styles.picker}>
        {options.map((opt) => (
          <Picker.Item key={opt} label={opt} value={opt} />
        ))}
      </Picker>
    </View>
  );
}

function FormField({
  column,
  value,
  error,
  onChange,
}: {
  column: Column;
  value: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.label}>
        {column.name}
        {column.required ? <Text style={styles.required}> *</Text> : null}
      </Text>

      {column.type.kind === 'date' && (
        <DateField value={value} onChange={onChange} />
      )}

      {column.type.kind === 'enum' && (
        <EnumField options={column.type.options} value={value} onChange={onChange} />
      )}

      {(column.type.kind === 'text' ||
        column.type.kind === 'float' ||
        column.type.kind === 'integer') && (
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={value}
          onChangeText={onChange}
          keyboardType={
            column.type.kind === 'float'
              ? 'decimal-pad'
              : column.type.kind === 'integer'
              ? 'number-pad'
              : 'default'
          }
          returnKeyType="done"
          placeholder={column.required ? 'Required' : 'Optional'}
          placeholderTextColor="#aaa"
        />
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// --- Main screen ---

export default function SheetScreen() {
  const { title: encodedTitle } = useLocalSearchParams<{ title: string }>();
  const title = decodeURIComponent(encodedTitle ?? '');

  const [metaState, setMetaState] = useState<MetaState>({ status: 'loading' });
  const [values, setValues] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<(string | null)[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');

  const loadMetadata = async () => {
    setMetaState({ status: 'loading' });
    try {
      const token = await getAccessToken();
      const rows = await fetchMetadata(token, title);

      if (rows.length === 0) {
        setMetaState({ status: 'error', message: 'No data in sheet' });
        return;
      }

      const [names, types, requiredFlags] = rows;
      const colCount = names.length;
      if (!types || types.length < colCount || !requiredFlags || requiredFlags.length < colCount) {
        setMetaState({ status: 'error', message: 'Sheet is incorrectly formatted' });
        return;
      }

      const columns = parseColumns(rows);
      setMetaState({ status: 'loaded', columns });
      setValues(columns.map((c) => initialValue(c.type)));
      setFieldErrors(columns.map(() => null));
    } catch (e: any) {
      setMetaState({ status: 'error', message: e.message ?? 'Failed to load sheet' });
    }
  };

  useEffect(() => { loadMetadata(); }, [title]);

  const handleSubmit = async () => {
    if (metaState.status !== 'loaded') return;
    const { columns } = metaState;

    const errors = columns.map((col, i) => validateField(values[i] ?? '', col.type, col.required));
    setFieldErrors(errors);
    if (errors.some((e) => e !== null)) return;

    setSubmitState('submitting');
    try {
      const token = await getAccessToken();
      await appendRow(token, title, values.map((v) => v.trim()));
      setSubmitState('success');
      setValues(columns.map((c) => initialValue(c.type)));
      setFieldErrors(columns.map(() => null));
      setTimeout(() => setSubmitState('idle'), 2000);
    } catch (e: any) {
      setSubmitState({ error: e.message ?? 'Failed to log row' });
    }
  };

  const updateValue = (index: number, value: string) => {
    setValues((prev) => prev.map((v, i) => (i === index ? value : v)));
    if (fieldErrors[index]) {
      setFieldErrors((prev) => prev.map((e, i) => (i === index ? null : e)));
    }
  };

  if (metaState.status === 'loading') {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1a73e8" />
        </View>
      </>
    );
  }

  if (metaState.status === 'error') {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{metaState.message}</Text>
          <TouchableOpacity onPress={loadMetadata} style={styles.button}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const { columns } = metaState;
  const isSubmitting = submitState === 'submitting';

  return (
    <>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {columns.map((col, i) => (
            <FormField
              key={col.name}
              column={col}
              value={values[i] ?? ''}
              error={fieldErrors[i] ?? null}
              onChange={(v) => updateValue(i, v)}
            />
          ))}

          <TouchableOpacity
            style={[styles.button, styles.submitButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Log</Text>
            )}
          </TouchableOpacity>

          {submitState === 'success' && (
            <Text style={styles.successText}>Logged!</Text>
          )}
          {typeof submitState === 'object' && submitState.error ? (
            <Text style={styles.errorText}>{submitState.error}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  fieldContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5f6368',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  required: {
    color: '#d93025',
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#202124',
  },
  inputError: {
    borderColor: '#d93025',
  },
  datePicker: {
    alignSelf: 'flex-start',
  },
  androidDateButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  androidDateText: {
    fontSize: 16,
    color: '#202124',
  },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  picker: {
    color: '#202124',
  },
  errorText: {
    fontSize: 13,
    color: '#d93025',
    marginTop: 4,
    textAlign: 'center',
  },
  successText: {
    fontSize: 15,
    color: '#188038',
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#1a73e8',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButton: {
    marginTop: 8,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
