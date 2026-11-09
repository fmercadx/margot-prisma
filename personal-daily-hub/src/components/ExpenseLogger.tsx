import { Plus, Wallet, X } from '../icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { clockTime } from '../lib/date';
import { formatCents, parseAmountToCents } from '../lib/money';
import { EXPENSE_LABEL_MAX_LENGTH, type Expense } from '../lib/store';
import { colors, inputColors, HIT, radius, space, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

type Props = {
  expenses: Expense[];
  totalCents: number;
  onAdd: (cents: number, label: string) => void;
  onDelete: (id: string) => void;
};

export function ExpenseLogger({ expenses, totalCents, onAdd, onDelete }: Props) {
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const cents = parseAmountToCents(amount);
    if (cents === null) {
      setError('Enter an amount like 12.50');
      return;
    }
    onAdd(cents, label);
    setAmount('');
    setLabel('');
    setError(null);
  };

  return (
    <Card
      icon={Wallet}
      accent={colors.expenses}
      title="Expenses"
      subtitle={expenses.length === 1 ? '1 entry today' : `${expenses.length} entries today`}
      testID="card-expenses"
    >
      <View>
        <Text style={styles.totalLabel}>Spent today</Text>
        <Text style={styles.total} testID="expense-total" accessibilityLiveRegion="polite">
          {formatCents(totalCents)}
        </Text>
      </View>

      <View style={styles.form}>
        <View style={[styles.amountWrap, error && styles.invalid]}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            value={amount}
            onChangeText={(t) => {
              setAmount(t);
              setError(null);
            }}
            placeholder="0.00"
            {...inputColors}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            maxLength={12}
            accessibilityLabel="Amount in dollars"
            testID="expense-amount"
          />
        </View>
        <TextInput
          value={label}
          onChangeText={setLabel}
          onSubmitEditing={submit}
          placeholder="What for?"
          {...inputColors}
          style={styles.labelInput}
          maxLength={EXPENSE_LABEL_MAX_LENGTH}
          returnKeyType="done"
          submitBehavior="submit"
          accessibilityLabel="What the expense was for (optional)"
          testID="expense-label"
        />
        <Pressable
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="Add expense"
          style={({ pressed }) => [styles.add, pressed && { opacity: 0.8 }]}
          testID="expense-submit"
        >
          <Plus size={20} color={colors.background} strokeWidth={2.75} />
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}

      {expenses.length > 0 ? (
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {expenses.map((e, i) => (
            <View key={e.id} style={[styles.item, i > 0 && styles.divider]}>
              <View style={styles.itemBody}>
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {e.label || 'Expense'}
                </Text>
                <Text style={styles.itemTime}>{clockTime(e.createdAt)}</Text>
              </View>
              <Text style={styles.itemAmount}>{formatCents(e.cents)}</Text>
              <IconButton
                icon={X}
                size={16}
                label={`Delete ${e.label || 'expense'} ${formatCents(e.cents)}`}
                onPress={() => onDelete(e.id)}
                color={colors.textMuted}
              />
            </View>
          ))}
        </ScrollView>
      ) : null}
    </Card>
  );
}

const field = {
  minHeight: HIT + 4,
  backgroundColor: colors.cardRaised,
  borderRadius: radius.md,
  color: colors.text,
  ...type.body,
} as const;

const styles = StyleSheet.create({
  totalLabel: { ...type.caption, color: colors.textSecondary },
  // Proportional figures: a lone large number looks loose in tabular digits.
  total: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5, color: colors.text },
  form: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  amountWrap: {
    ...field,
    width: 112,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  invalid: { borderColor: colors.danger },
  currency: { ...type.body, color: colors.textSecondary, marginRight: 2 },
  // Explicit zero padding: Android's default EditText padding would push
  // the digits away from the "$".
  amountInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...type.body,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: space.sm,
  },
  labelInput: { ...field, flex: 1, minWidth: 0, paddingHorizontal: space.md },
  add: {
    width: HIT + 4,
    height: HIT + 4,
    borderRadius: radius.md,
    backgroundColor: colors.expenses,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { ...type.caption, color: colors.danger, marginTop: -space.sm },
  list: { maxHeight: 232 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  itemBody: { flex: 1, paddingVertical: space.sm, gap: 2 },
  itemLabel: { ...type.body, color: colors.text },
  itemTime: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  itemAmount: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
