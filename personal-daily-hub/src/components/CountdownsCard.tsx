import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Check, Hourglass, Minus, Plus, X } from '../icons';
import { dateKey, longDate, parseDateKey, weekdayName } from '../lib/date';
import {
  COUNTDOWN_LABEL_MAX_LENGTH,
  COUNTDOWN_MAX_DAYS,
  COUNTDOWNS_MAX,
  daysUntil,
  type Countdown,
} from '../lib/store';
import { colors, HIT, inputColors, radius, space, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

type Props = {
  countdowns: Countdown[];
  today: string;
  onAdd: (label: string, date: string) => void;
  onRemove: (id: string) => void;
};

/** "12 days", "Tomorrow", "Today", "3 days ago". */
export function countdownLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 1 ? `${days} days` : `${-days} days ago`;
}

/** The date `n` calendar days after `today`. */
function addDays(today: string, n: number): string {
  const t = parseDateKey(today);
  return dateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
}

const shortDate = (date: string) => {
  const d = parseDateKey(date);
  return `${weekdayName(d).slice(0, 3)}, ${longDate(d)}`;
};

/** Dates worth counting down to: a trip, a birthday, a deadline. */
export function CountdownsCard({ countdowns, today, onAdd, onRemove }: Props) {
  const [composing, setComposing] = useState(false);
  const [label, setLabel] = useState('');
  const [offset, setOffset] = useState(7);
  const date = addDays(today, offset);
  const canAdd = label.trim().length > 0;

  const close = () => {
    setComposing(false);
    setLabel('');
    setOffset(7);
  };
  const add = () => {
    if (!canAdd) return;
    onAdd(label, date);
    close();
  };
  const step = (n: number) => setOffset((o) => Math.min(COUNTDOWN_MAX_DAYS, Math.max(0, o + n)));

  return (
    <Card icon={Hourglass} accent={colors.countdown} title="Coming up" subtitle="Days until what you're looking forward to" testID="card-countdowns">
      {countdowns.length === 0 && !composing ? (
        <Text style={styles.empty}>Nothing yet. Add a trip, a birthday or a deadline.</Text>
      ) : null}

      {countdowns.map((c) => {
        const n = daysUntil(c.date, today);
        const passed = n < 0;
        return (
          <View
            key={c.id}
            style={[styles.row, passed && styles.passed]}
            accessible
            accessibilityLabel={`${c.label}, ${shortDate(c.date)}: ${countdownLabel(n)}`}
            testID="countdown"
          >
            <View style={styles.rowText}>
              <Text style={styles.label} numberOfLines={1}>
                {c.label}
              </Text>
              <Text style={styles.date}>{shortDate(c.date)}</Text>
            </View>
            <Text style={[styles.days, n <= 1 && n >= 0 && styles.soon]}>{countdownLabel(n)}</Text>
            <IconButton icon={X} size={16} label={`Remove ${c.label}`} onPress={() => onRemove(c.id)} color={colors.textMuted} />
          </View>
        );
      })}

      {composing ? (
        <View style={styles.composer} testID="countdown-composer">
          <TextInput
            value={label}
            onChangeText={setLabel}
            onSubmitEditing={add}
            placeholder="What’s coming up?"
            {...inputColors}
            style={styles.input}
            maxLength={COUNTDOWN_LABEL_MAX_LENGTH}
            autoFocus
            returnKeyType="done"
            submitBehavior="submit"
            accessibilityLabel="Countdown name"
          />
          <View style={styles.when}>
            <IconButton icon={Minus} size={16} label="One day sooner" onPress={() => step(-1)} disabled={offset <= 0} filled />
            <View style={styles.whenText} accessibilityLiveRegion="polite">
              <Text style={styles.whenDays} testID="countdown-offset">
                {countdownLabel(offset)}
              </Text>
              <Text style={styles.date}>{shortDate(date)}</Text>
            </View>
            <IconButton icon={Plus} size={16} label="One day later" onPress={() => step(1)} disabled={offset >= COUNTDOWN_MAX_DAYS} filled />
            <Pressable
              onPress={() => step(7)}
              accessibilityRole="button"
              accessibilityLabel="One week later"
              style={({ pressed }) => [styles.week, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.weekText}>+1 wk</Text>
            </Pressable>
          </View>
          <View style={styles.actions}>
            <IconButton icon={X} label="Cancel countdown" onPress={close} filled />
            <Pressable
              onPress={add}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityLabel="Add countdown"
              accessibilityState={{ disabled: !canAdd }}
              style={({ pressed }) => [styles.save, !canAdd && styles.saveOff, pressed && { opacity: 0.85 }]}
            >
              <Check size={16} color={canAdd ? colors.background : colors.textMuted} strokeWidth={2.75} />
              <Text style={[styles.saveText, !canAdd && styles.saveTextOff]}>Add</Text>
            </Pressable>
          </View>
        </View>
      ) : countdowns.length < COUNTDOWNS_MAX ? (
        <Pressable
          onPress={() => setComposing(true)}
          accessibilityRole="button"
          accessibilityLabel="Add a date to count down to"
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
          testID="countdown-add"
        >
          <Plus size={16} color={colors.textSecondary} strokeWidth={2.5} />
          <Text style={styles.addText}>Add a date</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { ...type.body, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: HIT },
  passed: { opacity: 0.55 },
  rowText: { flex: 1, gap: 2 },
  label: { ...type.body, color: colors.text, fontWeight: '600' },
  date: { ...type.caption, color: colors.textSecondary },
  days: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  soon: { color: colors.countdown },
  composer: { gap: space.md },
  input: {
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  when: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  whenText: { flex: 1, alignItems: 'center', gap: 2 },
  whenDays: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  week: {
    minHeight: HIT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekText: { ...type.label, color: colors.textSecondary, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: HIT,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.countdown,
  },
  saveOff: { backgroundColor: colors.cardRaised },
  saveText: { ...type.label, color: colors.background, fontWeight: '700' },
  saveTextOff: { color: colors.textMuted },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: HIT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
  },
  addText: { ...type.label, color: colors.textSecondary },
});
