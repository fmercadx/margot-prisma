import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, ChevronLeft, ChevronRight, X } from '../icons';
import { clockTime, longDate, parseDateKey, weekdayName } from '../lib/date';
import { formatCents } from '../lib/money';
import { moodWord } from '../lib/mood';
import { ENERGY_MAX, EMPTY_DAY, totalCents, type DayLog, type Habit } from '../lib/store';
import { colors, radius, space, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  date: string | null; // null = closed
  isToday: boolean;
  log: DayLog | null;
  habits: Habit[];
  waterGoal: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

/**
 * Everything logged on one day, read-only. Steps back and forward through
 * the days the app has loaded. The home screen is where today is edited.
 */
export function DaySheet(p: Props) {
  const insets = useSafeAreaInsets();
  const day = p.log ?? EMPTY_DAY;
  const date = p.date ? parseDateKey(p.date) : null;
  const done = p.habits.filter((h) => day.habitsDone.includes(h.id));
  const nothing =
    day.notes.length === 0 &&
    day.expenses.length === 0 &&
    done.length === 0 &&
    day.water === 0 &&
    day.energy === null &&
    day.mood === null;

  return (
    <Modal
      visible={p.date !== null}
      transparent
      animationType="slide"
      onRequestClose={p.onClose}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Dismiss day" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal testID="day-sheet">
          <View style={styles.head}>
            <IconButton icon={ChevronLeft} label="Previous day" onPress={p.onPrev} disabled={!p.canPrev} filled />
            <View style={styles.titles}>
              <Text style={styles.title} accessibilityRole="header" testID="day-sheet-title">
                {date ? (p.isToday ? 'Today' : weekdayName(date)) : ''}
              </Text>
              <Text style={styles.subtitle}>{date ? longDate(date) : ''}</Text>
            </View>
            <IconButton icon={ChevronRight} label="Next day" onPress={p.onNext} disabled={!p.canNext} filled />
            <IconButton icon={X} label="Close day" onPress={p.onClose} filled />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.stats}>
              <Stat label="Water" value={day.water > 0 ? `${day.water}/${p.waterGoal}` : '—'} />
              <Stat label="Energy" value={day.energy === null ? '—' : `${day.energy}/${ENERGY_MAX}`} />
              <Stat label="Mood" value={day.mood === null ? '—' : moodWord(day.mood)} />
              <Stat label="Spent" value={day.expenses.length ? formatCents(totalCents(day)) : '—'} />
            </View>

            {nothing ? <Text style={styles.empty}>Nothing was logged on this day.</Text> : null}

            {done.length > 0 ? (
              <Section title={`Habits · ${done.length}/${p.habits.length}`}>
                {done.map((h) => (
                  <View key={h.id} style={styles.line}>
                    <Check size={16} color={colors.habits} strokeWidth={3} />
                    <Text style={styles.lineText}>{h.label}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {day.notes.length > 0 ? (
              <Section title={`Notes · ${day.notes.length}`}>
                {day.notes.map((n) => (
                  <View key={n.id} style={styles.item}>
                    <Text style={styles.lineText}>{n.text}</Text>
                    <Text style={styles.meta}>
                      {clockTime(n.createdAt)}
                      {n.editedAt ? ' · edited' : ''}
                    </Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {day.expenses.length > 0 ? (
              <Section title={`Expenses · ${formatCents(totalCents(day))}`}>
                {day.expenses.map((e) => (
                  <View key={e.id} style={[styles.line, styles.spread]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineText}>{e.label || 'Expense'}</Text>
                      <Text style={styles.meta}>{clockTime(e.createdAt)}</Text>
                    </View>
                    <Text style={styles.amount}>{formatCents(e.cents)}</Text>
                  </View>
                ))}
              </Section>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value === '—' ? 'not logged' : value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: space.lg,
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%',
    alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  titles: { flex: 1, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { ...type.caption, color: colors.textSecondary },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: space.xl, paddingBottom: space.sm, gap: space.lg },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, backgroundColor: colors.cardRaised, borderRadius: radius.md, padding: space.md, gap: 2 },
  statLabel: { ...type.caption, color: colors.textSecondary },
  statValue: { ...type.body, fontWeight: '700', color: colors.text },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingVertical: space.lg },
  section: { gap: space.sm },
  sectionTitle: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { backgroundColor: colors.cardRaised, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  spread: { justifyContent: 'space-between' },
  item: { paddingVertical: space.sm, gap: 2 },
  lineText: { ...type.body, color: colors.text, flexShrink: 1 },
  meta: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  amount: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
