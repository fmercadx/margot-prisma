import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, ChevronLeft, ChevronRight, Circle, CircleCheck, Forward, Share2, SkipForward, Target, Timer, X } from '../icons';
import { dayAsText } from '../lib/dayText';
import { CATEGORY_LABELS } from '../lib/categories';
import { clockTime, longDate, parseDateKey, weekdayName } from '../lib/date';
import { moodWord } from '../lib/mood';
import { ENERGY_MAX, EMPTY_DAY, expenseName, focusLabel, isDue, totalCents, type DayLog, type Habit } from '../lib/store';
import { colors, radius, space, type } from '../theme';
import { CATEGORY_ICONS } from './categoryIcons';
import { IconButton } from './IconButton';
import { useMoney } from './Money';
import { sleepLabel } from './WaterEnergy';

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
  /** Hands the day, as plain text, to the system share sheet. */
  onShare: (text: string) => void;
};

/**
 * Everything logged on one day, read-only. Steps back and forward through
 * the days the app has loaded. The home screen is where today is edited.
 */
export function DaySheet(p: Props) {
  const insets = useSafeAreaInsets();
  const { money } = useMoney();
  const day = p.log ?? EMPTY_DAY;
  const date = p.date ? parseDateKey(p.date) : null;
  const done = p.habits.filter((h) => day.habitsDone.includes(h.id));
  const skipped = p.habits.filter((h) => day.habitsSkipped.includes(h.id));
  // Out of the habits meant for that weekday and not set aside; one done on a day off still shows.
  const due = p.date ? p.habits.filter((h) => isDue(h, p.date!, day)) : p.habits;
  const doneDue = due.filter((h) => day.habitsDone.includes(h.id)).length;
  const nothing =
    !day.focus &&
    !day.journal &&
    day.notes.length === 0 &&
    day.expenses.length === 0 &&
    done.length === 0 &&
    skipped.length === 0 &&
    day.focusMinutes === 0 &&
    day.water === 0 &&
    day.energy === null &&
    day.mood === null &&
    day.sleep === null;

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
            <IconButton
              icon={Share2}
              label="Share this day"
              onPress={() => p.date && p.onShare(dayAsText(p.date, day, p.habits, p.waterGoal, money))}
              filled
            />
            <IconButton icon={X} label="Close day" onPress={p.onClose} filled />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.stats}>
              <Stat label="Water" value={day.water > 0 ? `${day.water}/${p.waterGoal}` : '—'} />
              <Stat label="Sleep" value={day.sleep === null ? '—' : sleepLabel(day.sleep)} />
              <Stat label="Energy" value={day.energy === null ? '—' : `${day.energy}/${ENERGY_MAX}`} />
              <Stat label="Mood" value={day.mood === null ? '—' : moodWord(day.mood)} />
              <Stat label="Spent" value={day.expenses.length ? money(totalCents(day)) : '—'} />
            </View>

            {nothing ? <Text style={styles.empty}>Nothing was logged on this day.</Text> : null}

            {day.focus ? (
              <View style={styles.focus} accessible accessibilityLabel={`Focus: ${day.focus}`}>
                <Target size={16} color={colors.focus} strokeWidth={2.25} />
                <Text style={styles.focusText}>{day.focus}</Text>
              </View>
            ) : null}

            {day.focusMinutes > 0 ? (
              <View style={styles.focus} accessible accessibilityLabel={`Focused for ${focusLabel(day.focusMinutes)}`}>
                <Timer size={16} color={colors.focus} strokeWidth={2.25} />
                <Text style={styles.focusText}>Focused for {focusLabel(day.focusMinutes)}</Text>
              </View>
            ) : null}

            {done.length > 0 || skipped.length > 0 ? (
              <Section title={`Habits · ${doneDue}/${due.length}`}>
                {done.map((h) => (
                  <View key={h.id} style={styles.line}>
                    <Check size={16} color={colors.habits} strokeWidth={3} />
                    <Text style={styles.lineText}>{h.label}</Text>
                  </View>
                ))}
                {skipped.map((h) => (
                  <View key={h.id} style={styles.line} accessible accessibilityLabel={`${h.label}, skipped`}>
                    <SkipForward size={16} color={colors.textMuted} strokeWidth={2.5} />
                    <Text style={[styles.lineText, styles.muted]}>{h.label} · skipped</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {day.notes.length > 0 ? (
              <Section title={`Notes · ${day.notes.length}`}>
                {day.notes.map((n) => {
                  const state = !n.task ? null : n.carriedTo ? 'moved' : n.doneAt !== undefined ? 'done' : 'open';
                  return (
                    <View
                      key={n.id}
                      style={[styles.item, state && styles.taskItem]}
                      accessible={state !== null}
                      accessibilityLabel={
                        state === 'done'
                          ? `To-do, done: ${n.text}`
                          : state === 'moved'
                            ? `To-do, brought over to the next day: ${n.text}`
                            : state === 'open'
                              ? `To-do, not done: ${n.text}`
                              : undefined
                      }
                    >
                      {state === 'done' ? (
                        <CircleCheck size={16} color={colors.notes} strokeWidth={2.25} />
                      ) : state === 'moved' ? (
                        <Forward size={16} color={colors.textMuted} strokeWidth={2.25} />
                      ) : state === 'open' ? (
                        <Circle size={16} color={colors.textSecondary} strokeWidth={2} />
                      ) : null}
                      <View style={styles.itemText}>
                        <Text style={[styles.lineText, state === 'done' && styles.done]}>{n.text}</Text>
                        <Text style={styles.meta}>
                          {clockTime(n.createdAt)}
                          {n.editedAt ? ' · edited' : ''}
                          {state === 'moved' ? ' · brought over to the next day' : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Section>
            ) : null}

            {day.journal ? (
              <Section title="Journal">
                <Text style={[styles.lineText, styles.journal]} testID="day-journal">
                  {day.journal}
                </Text>
              </Section>
            ) : null}

            {day.expenses.length > 0 ? (
              <Section title={`Expenses · ${money(totalCents(day))}`}>
                {day.expenses.map((e) => {
                  const Icon = CATEGORY_ICONS[e.category];
                  return (
                    <View key={e.id} style={[styles.line, styles.spread]}>
                      <Icon size={16} color={colors.textSecondary} strokeWidth={2.25} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lineText}>{expenseName(e)}</Text>
                        <Text style={styles.meta}>
                          {clockTime(e.createdAt)} · {CATEGORY_LABELS[e.category]}
                        </Text>
                      </View>
                      <Text style={styles.amount}>{money(e.cents)}</Text>
                    </View>
                  );
                })}
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
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexGrow: 1, flexBasis: '30%', backgroundColor: colors.cardRaised, borderRadius: radius.md, padding: space.md, gap: 2 },
  statLabel: { ...type.caption, color: colors.textSecondary },
  statValue: { ...type.body, fontWeight: '700', color: colors.text },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingVertical: space.lg },
  focus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    padding: space.md,
  },
  focusText: { ...type.body, fontWeight: '600', color: colors.text, flex: 1 },
  section: { gap: space.sm },
  sectionTitle: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { backgroundColor: colors.cardRaised, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  spread: { justifyContent: 'space-between' },
  item: { paddingVertical: space.sm, gap: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  itemText: { flex: 1, gap: 2 },
  done: { color: colors.textMuted, textDecorationLine: 'line-through' },
  lineText: { ...type.body, color: colors.text, flexShrink: 1 },
  muted: { color: colors.textMuted },
  meta: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  amount: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  journal: { paddingVertical: space.sm, lineHeight: 22 },
});
