import { StyleSheet, Text, View } from 'react-native';

import { CATEGORY_LABELS, type ExpenseCategory } from '../lib/categories';
import { formatCents } from '../lib/money';
import { colors, space, type } from '../theme';
import { CATEGORY_ICONS } from './categoryIcons';

type Props = {
  title: string;
  /** Largest first, as categoryTotals() returns them. */
  rows: { category: ExpenseCategory; cents: number }[];
  testID?: string;
};

/**
 * Where money went, one row per category, largest first. A bar list rather
 * than a stacked bar: each row carries its own name, icon and amount, so a
 * single colour does and no category depends on telling hues apart.
 */
export function CategoryBars({ title, rows, testID }: Props) {
  const total = rows.reduce((n, r) => n + r.cents, 0);
  if (rows.length === 0 || total <= 0) return null;
  const max = rows[0].cents;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {rows.map(({ category, cents }) => {
        const Icon = CATEGORY_ICONS[category];
        return (
          <View
            key={category}
            style={styles.row}
            accessible
            accessibilityLabel={`${CATEGORY_LABELS[category]}: ${formatCents(cents)}, ${Math.round((cents / total) * 100)}%`}
          >
            <Icon size={14} color={colors.textSecondary} strokeWidth={2.25} />
            <Text style={styles.name} numberOfLines={1}>
              {CATEGORY_LABELS[category]}
            </Text>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.max(2, (cents / max) * 100)}%` }]} />
            </View>
            <Text style={styles.amount}>{formatCents(cents)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, paddingTop: space.xs },
  title: { ...type.label, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  name: { ...type.label, color: colors.text, width: 76 },
  track: { flex: 1, height: 8 },
  bar: { height: 8, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.expenses },
  amount: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'right' },
});
