import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getAccessToken } from '@/src/lib/auth';
import { appendRow, fetchMetadata } from '@/src/lib/sheets';

// --- Types ---

type ColumnType =
  | { kind: 'text' }
  | { kind: 'float' }
  | { kind: 'integer' }
  | { kind: 'date' }
  | { kind: 'enum'; options: string[] }
  | { kind: 'boolean' };

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
    case 'boolean': return { kind: 'boolean' };
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
  if (type.kind === 'boolean') return 'FALSE';
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

function SpinnerColumn({
  label,
  value,
  min,
  max,
  width,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  width: number;
  onChange: (v: number) => void;
}) {
  const dec = () => onChange(value > min ? value - 1 : max);
  const inc = () => onChange(value < max ? value + 1 : min);
  const display = label === 'Year' ? String(value) : String(value).padStart(2, '0');
  return (
    <View style={styles.spinnerCol}>
      <Text style={styles.spinnerLabel}>{label}</Text>
      <TouchableOpacity onPress={inc} style={styles.spinnerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.spinnerArrow}>▲</Text>
      </TouchableOpacity>
      <Text style={[styles.spinnerValue, { width }]}>{display}</Text>
      <TouchableOpacity onPress={dec} style={styles.spinnerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.spinnerArrow}>▼</Text>
      </TouchableOpacity>
    </View>
  );
}

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);

  const parsed = useMemo(() => {
    const parts = value.split('-');
    if (parts.length === 3) {
      const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
      if (!isNaN(y) && m >= 1 && m <= 12 && d >= 1 && d <= 31) return { year: y, month: m, day: d };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }, [value]);

  const [year, setYear] = useState(parsed.year);
  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);

  const open = () => {
    setYear(parsed.year);
    setMonth(parsed.month);
    setDay(parsed.day);
    setShowPicker(true);
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const clampedDay = Math.min(day, daysInMonth);

  const handleMonthChange = (m: number) => {
    setMonth(m);
    setDay((d) => Math.min(d, new Date(year, m, 0).getDate()));
  };

  const confirm = () => {
    onChange(`${year}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`);
    setShowPicker(false);
  };

  return (
    <View>
      <TouchableOpacity onPress={open} style={styles.dateButton}>
        <Text style={styles.dateButtonText}>{value}</Text>
      </TouchableOpacity>
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.dateCard}>
            <Text style={styles.dateCardTitle}>Pick a date</Text>
            <View style={styles.spinnerRow}>
              <SpinnerColumn label="Year" value={year} min={2000} max={2100} width={56} onChange={setYear} />
              <SpinnerColumn label="Month" value={month} min={1} max={12} width={32} onChange={handleMonthChange} />
              <SpinnerColumn label="Day" value={clampedDay} min={1} max={daysInMonth} width={32} onChange={setDay} />
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setShowPicker(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirm} style={[styles.button, { flex: 1 }]}>
                <Text style={styles.buttonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  const [showPicker, setShowPicker] = useState(false);
  return (
    <View>
      <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.enumButton}>
        <Text style={styles.enumButtonText}>{value}</Text>
        <Text style={styles.enumChevron}>▾</Text>
      </TouchableOpacity>
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <View style={styles.enumCard}>
            {options.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.enumOption, opt === value && styles.enumOptionSelected]}
                onPress={() => { onChange(opt); setShowPicker(false); }}
              >
                <Text style={[styles.enumOptionText, opt === value && styles.enumOptionTextSelected]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function BooleanField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const checked = value === 'TRUE';
  return (
    <TouchableOpacity
      onPress={() => onChange(checked ? 'FALSE' : 'TRUE')}
      style={styles.checkboxRow}
      activeOpacity={0.7}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
    </TouchableOpacity>
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

      {column.type.kind === 'boolean' && (
        <BooleanField value={value} onChange={onChange} />
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
  dateButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dateButtonText: {
    fontSize: 16,
    color: '#202124',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: 300,
    elevation: 6,
  },
  dateCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
    textAlign: 'center',
    marginBottom: 20,
  },
  spinnerRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  spinnerCol: {
    alignItems: 'center',
    flex: 1,
  },
  spinnerLabel: {
    fontSize: 11,
    color: '#5f6368',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  spinnerBtn: {
    paddingVertical: 6,
  },
  spinnerArrow: {
    fontSize: 18,
    color: '#1a73e8',
  },
  spinnerValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#202124',
    textAlign: 'center',
    paddingVertical: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dadce0',
  },
  modalCancelText: {
    color: '#5f6368',
    fontSize: 16,
    fontWeight: '600',
  },
  enumButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  enumButtonText: {
    fontSize: 16,
    color: '#202124',
  },
  enumChevron: {
    fontSize: 18,
    color: '#5f6368',
  },
  enumCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    minWidth: 200,
    maxWidth: 320,
    elevation: 6,
  },
  enumOption: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  enumOptionSelected: {
    backgroundColor: '#e8f0fe',
  },
  enumOptionText: {
    fontSize: 16,
    color: '#202124',
  },
  enumOptionTextSelected: {
    color: '#1a73e8',
    fontWeight: '600',
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#dadce0',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#1a73e8',
    borderColor: '#1a73e8',
  },
  checkmark: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
});
