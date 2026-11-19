import { Eye, EyeOff, Plus, Repeat, TriangleAlert, Wallet, X } from '../icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  CATEGORY_LABELS,
  categoryTotals,
  DEFAULT_CATEGORY,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '../lib/categories';
import { clockTime } from '../lib/date';
import { parseAmountToCents } from '../lib/money';
import { expenseName, EXPENSE_LABEL_MAX_LENGTH, type Expense } from '../lib/store';
import { colors, inputColors, HIT, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { CategoryBars } from './CategoryBars';
import { CATEGORY_ICONS } from './categoryIcons';
import { IconButton } from './IconButton';
import { useMoney } from './Money';

type Props = {
  expenses: Expense[];
  totalCents: number;
  /** The daily budget in cents, or null for none. */
  budgetCents: number | null;
  onAdd: (cents: number, label: string, category: ExpenseCategory) => void;
  onDelete: (id: string) => void;
  /** Recent distinct expenses, offered to add again with one tap. */
  recent: Expense[];
  onRepeat: (e: Expense) => void;
  /** "Hide amounts" is on. */
  hidden: boolean;
  onToggleHidden: () => void;
  /** "today", "yesterday" or "on Tuesday": the day being logged. */
  dayWord?: string;
};

export function ExpenseLogger(props: Props) {
  const { expenses, totalCents, budgetCents, onAdd, onDelete, recent, onRepeat, hidden, onToggleHidden } = props;
  const dayWord = props.dayWord ?? 'today';
  const { money } = useMoney();
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  // Kept after adding: several expenses in a row are often the same kind.
  const [category, setCategory] = useState<ExpenseCategory>(DEFAULT_CATEGORY);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const cents = parseAmountToCents(amount);
    if (cents === null) {
      setError('Enter an amount like 12.50');
      return;
    }
    onAdd(cents, label, category);
    setAmount('');
    setLabel('');
    setError(null);
  };

  return (
    <Card
      icon={Wallet}
      accent={colors.expenses}
      title="Expenses"
      subtitle={expenses.length === 1 ? `1 entry ${dayWord}` : `${expenses.length} entries ${dayWord}`}
      right={
        <IconButton
          icon={hidden ? EyeOff : Eye}
          size={18}
          label={hidden ? 'Show amounts' : 'Hide amounts'}
          onPress={onToggleHidden}
          color={hidden ? colors.expenses : colors.textMuted}
          testID="toggle-amounts"
        />
      }
      testID="card-expenses"
    >
      <View style={styles.totals}>
        <Text style={styles.totalLabel}>Spent {dayWord}</Text>
        <Text style={styles.total} testID="expense-total" accessibilityLiveRegion="polite">
          {money(totalCents)}
        </Text>
        {budgetCents !== null ? <Budget spent={totalCents} budget={budgetCents} /> : null}
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

      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Category">
        {EXPENSE_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICONS[c];
          const on = c === category;
          return (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              hitSlop={4}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Category: ${CATEGORY_LABELS[c]}`}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
              testID={`category-${c}`}
            >
              <Icon size={14} color={on ? colors.text : colors.textSecondary} strokeWidth={2.25} />
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{CATEGORY_LABELS[c]}</Text>
            </Pressable>
          );
        })}
      </View>

      {recent.length > 0 ? (
        <View style={styles.recent} testID="recent-expenses">
          <View style={styles.recentHead}>
            <Repeat size={13} color={colors.textSecondary} strokeWidth={2.25} />
            <Text style={styles.recentTitle}>Add again</Text>
          </View>
          <View style={styles.recentRow}>
            {recent.map((e) => {
              const Icon = CATEGORY_ICONS[e.category];
              return (
                <Pressable
                  key={e.id}
                  onPress={() => onRepeat(e)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`Add again: ${expenseName(e)}, ${money(e.cents)}`}
                  style={({ pressed }) => [styles.again, pressed && { opacity: 0.7 }]}
                >
                  <Icon size={13} color={colors.textSecondary} strokeWidth={2.25} />
                  <Text style={styles.againName} numberOfLines={1}>
                    {expenseName(e)}
                  </Text>
                  <Text style={styles.againAmount}>{money(e.cents)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {expenses.length > 0 ? (
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {expenses.map((e, i) => {
            const Icon = CATEGORY_ICONS[e.category];
            return (
              <View key={e.id} style={[styles.item, i > 0 && styles.divider]}>
                <View style={styles.itemIcon} accessibilityLabel={CATEGORY_LABELS[e.category]}>
                  <Icon size={16} color={colors.textSecondary} strokeWidth={2.25} />
                </View>
                <View style={styles.itemBody}>
                  <Text style={styles.itemLabel} numberOfLines={1}>
                    {expenseName(e)}
                  </Text>
                  <Text style={styles.itemTime}>
                    {clockTime(e.createdAt)}
                    {e.label && e.category !== DEFAULT_CATEGORY ? ` · ${CATEGORY_LABELS[e.category]}` : ''}
                  </Text>
                </View>
                <Text style={styles.itemAmount}>{money(e.cents)}</Text>
                <IconButton
                  icon={X}
                  size={16}
                  label={`Delete ${e.label || (e.category === DEFAULT_CATEGORY ? 'expense' : `${CATEGORY_LABELS[e.category].toLowerCase()} expense`)} ${money(e.cents)}`}
                  onPress={() => onDelete(e.id)}
                  color={colors.textMuted}
                />
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Once there is more than one category to compare. */}
      {categoryTotals(expenses).length > 1 ? (
        <CategoryBars title="Where it went" rows={categoryTotals(expenses)} testID="expense-breakdown" />
      ) : null}
    </Card>
  );
}

/** Spent against the day's budget: what is left, or how far over. */
function Budget({ spent, budget }: { spent: number; budget: number }) {
  const { money } = useMoney();
  const over = spent > budget;
  const share = Math.min(1, spent / budget);
  const text = over
    ? `${money(spent - budget)} over your ${money(budget)} budget`
    : `${money(budget - spent)} left of ${money(budget)}`;
  return (
    <View style={styles.budget} testID="budget" accessible accessibilityLabel={text}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${share * 100}%`, backgroundColor: over ? colors.warning : colors.expenses },
          ]}
        />
      </View>
      <View style={styles.budgetLine}>
        {over ? <TriangleAlert size={14} color={colors.warning} strokeWidth={2.5} /> : null}
        <Text style={[styles.budgetText, over && styles.overText]} testID="budget-text">
          {text}
        </Text>
      </View>
    </View>
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
  totals: { gap: 2 },
  totalLabel: { ...type.caption, color: colors.textSecondary },
  budget: { gap: space.xs, marginTop: space.xs },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.cardRaised, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  budgetLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetText: { ...type.caption, color: colors.textSecondary },
  overText: { color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: -space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipOn: { backgroundColor: tint(colors.expenses, 0.16), borderColor: colors.expenses },
  chipText: { ...type.label, color: colors.textSecondary },
  chipTextOn: { color: colors.text, fontWeight: '600' },
  recent: { gap: space.sm },
  recentHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recentTitle: { ...type.caption, color: colors.textSecondary },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  again: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    maxWidth: '100%',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  againName: { ...type.label, color: colors.text, flexShrink: 1 },
  againAmount: { ...type.label, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  itemIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
