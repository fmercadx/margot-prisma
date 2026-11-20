import { ArrowDown, ArrowUp, CalendarClock, Check, CircleCheckBig, Flame, Lock, Plus, SkipForward, X } from '../icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { weekdaysLabel } from '../lib/date';
import { HABIT_MAX_LENGTH, isDue, isScheduled, type Habit } from '../lib/store';
import { colors, inputColors, HIT, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

type Props = {
  habits: Habit[];
  done: string[];
  /** Habits set aside for the day: they don't count, and streaks carry over them. */
  skipped: string[];
  onSkip: (id: string) => void;
  /** Moves a habit next to another one. */
  onMove: (id: string, nextTo: string, where: 'before' | 'after') => void;
  /** Days in a row each habit has been done, by habit id. */
  streaks: Record<string, number>;
  /** The most days a streak can show (the history that is loaded). */
  streakCap: number;
  isPremium: boolean;
  composerOpen: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  /** Free users get the paywall; premium users get the composer. */
  onRequestAdd: () => void;
  onCloseComposer: () => void;
  /** Returns null on success, or the reason the habit was not added. */
  onAdd: (label: string) => string | null;
  today: string;
  /** Weekdays a habit is meant for; null = every day. */
  onSetDays: (id: string, days: number[] | null) => void;
  /** Renames a custom habit. Returns null on success, or why not. */
  onRename: (id: string, label: string) => string | null;
  /** The day being logged is today (false while filling in an earlier day). */
  isToday?: boolean;
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function HabitChecklist(props: Props) {
  const { habits, done, skipped, isPremium, composerOpen } = props;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  // Habits not meant for today, or set aside, sit apart, below the rest, and don't count.
  const day = { habitsSkipped: skipped };
  const due = habits.filter((h) => isDue(h, props.today, day));
  const resting = habits.filter((h) => !isDue(h, props.today, day));
  const doneCount = due.filter((h) => done.includes(h.id)).length;
  const dayWord = props.isToday === false ? 'that day' : 'today';

  const submit = () => {
    const problem = props.onAdd(draft);
    setError(problem);
    if (problem === null) {
      setDraft('');
      props.onCloseComposer();
    }
  };

  const cancel = () => {
    setDraft('');
    setError(null);
    props.onCloseComposer();
  };

  const renderHabit = (habit: Habit, rest: boolean, group: Habit[], i: number) => {
    const checked = done.includes(habit.id);
    const isSkipped = skipped.includes(habit.id);
    const open = scheduling === habit.id;
    return (
      <View key={habit.id}>
        <View style={[styles.row, rest && styles.resting]}>
          <Pressable
            onPress={() => props.onToggle(habit.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={isSkipped ? `${habit.label}, skipped ${dayWord}` : habit.label}
            accessibilityHint={
              isSkipped
                ? 'Ticking it takes it back'
                : habit.days
                  ? `Planned for ${weekdaysLabel(habit.days)}`
                  : undefined
            }
            style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.7 }]}
            testID={`habit-${habit.id}`}
          >
            <View style={[styles.box, checked && styles.boxChecked, isSkipped && styles.boxSkipped]}>
              {checked ? <Check size={15} color={colors.background} strokeWidth={3} /> : null}
              {isSkipped ? <SkipForward size={13} color={colors.textMuted} strokeWidth={2.5} /> : null}
            </View>
            <View style={styles.labelCol}>
              <Text style={[styles.label, checked && styles.labelDone]}>{habit.label}</Text>
              {isSkipped ? (
                <Text style={styles.schedule}>Skipped {dayWord} · the streak carries on</Text>
              ) : habit.days && !open ? (
                <Text style={styles.schedule}>{weekdaysLabel(habit.days)}</Text>
              ) : null}
            </View>
            <StreakChip days={props.streaks[habit.id] ?? 0} cap={props.streakCap} />
          </Pressable>
          <IconButton
            icon={CalendarClock}
            size={16}
            label={`Edit ${habit.label}`}
            onPress={() => setScheduling(open ? null : habit.id)}
            color={open || habit.days ? colors.habits : colors.textMuted}
          />
          {habit.core ? null : (
            <IconButton
              icon={X}
              size={16}
              label={`Remove habit: ${habit.label}`}
              onPress={() => props.onRemove(habit.id)}
              color={colors.textMuted}
            />
          )}
        </View>
        {open ? (
          <DayPicker
            label={habit.label}
            days={habit.days}
            onChange={(days) => props.onSetDays(habit.id, days)}
            onDone={() => setScheduling(null)}
            onRename={habit.core ? undefined : (label) => props.onRename(habit.id, label)}
            onUp={i > 0 ? () => props.onMove(habit.id, group[i - 1].id, 'before') : undefined}
            onDown={i < group.length - 1 ? () => props.onMove(habit.id, group[i + 1].id, 'after') : undefined}
            skip={
              // Only a habit meant for the day can be set aside.
              isScheduled(habit, props.today)
                ? { skipped: isSkipped, dayWord, onToggle: () => props.onSkip(habit.id) }
                : undefined
            }
          />
        ) : null}
      </View>
    );
  };

  return (
    <Card
      icon={CircleCheckBig}
      accent={colors.habits}
      title="Habits"
      subtitle={due.length > 0 && doneCount === due.length ? 'All done — nice work' : 'Small wins, every day'}
      right={
        <Text style={styles.count} accessibilityLabel={`${doneCount} of ${due.length} habits done`}>
          {doneCount}/{due.length}
        </Text>
      }
      testID="card-habits"
    >
      <View>
        {due.map((habit, i) => renderHabit(habit, false, due, i))}
        {resting.length > 0 ? (
          <Text style={styles.restHeader} accessibilityRole="header">
            {props.isToday === false ? 'Not planned that day' : 'Not today'}
          </Text>
        ) : null}
        {resting.map((habit, i) => renderHabit(habit, true, resting, i))}
      </View>

      {composerOpen ? (
        <View style={styles.composer}>
          <View style={styles.composerRow}>
            <TextInput
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                setError(null);
              }}
              onSubmitEditing={submit}
              placeholder="e.g. Stretch for 5 minutes"
              {...inputColors}
              style={styles.input}
              maxLength={HABIT_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              submitBehavior="submit"
              accessibilityLabel="New habit name"
              testID="habit-input"
            />
            <IconButton icon={Check} label="Add habit" onPress={submit} color={colors.habits} filled />
            <IconButton icon={X} label="Cancel" onPress={cancel} filled />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <Pressable
          onPress={props.onRequestAdd}
          accessibilityRole="button"
          accessibilityLabel={isPremium ? 'Add a custom habit' : 'Add a custom habit (Premium)'}
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
          testID="habit-add"
        >
          <Plus size={16} color={colors.textSecondary} strokeWidth={2.5} />
          <Text style={styles.addText}>Add custom habit</Text>
          {isPremium ? null : <Lock size={13} color={colors.premium} strokeWidth={2.5} />}
        </Pressable>
      )}
    </Card>
  );
}

/** Seven day toggles. At least one stays on; all seven means every day. */
function DayPicker(props: {
  label: string;
  days: number[] | undefined;
  onChange: (days: number[] | null) => void;
  onDone: () => void;
  /** Custom habits can be renamed here too. */
  onRename?: (label: string) => string | null;
  /** Move it up or down its group; absent at either end. */
  onUp?: () => void;
  onDown?: () => void;
  /** Set it aside for the day, or take it back. Absent on a day it isn't meant for. */
  skip?: { skipped: boolean; dayWord: string; onToggle: () => void };
}) {
  const [name, setName] = useState(props.label);
  const [nameError, setNameError] = useState<string | null>(null);
  const done = () => {
    if (props.onRename && name.trim() !== props.label) {
      const problem = props.onRename(name);
      if (problem) {
        setNameError(problem);
        return;
      }
    }
    props.onDone();
  };
  const on = props.days ?? [0, 1, 2, 3, 4, 5, 6];
  const toggle = (d: number) => {
    const next = on.includes(d) ? on.filter((x) => x !== d) : [...on, d].sort();
    if (next.length === 0) return;
    props.onChange(next.length === 7 ? null : next);
  };
  return (
    <View
      style={styles.picker}
      accessibilityRole="none"
      accessibilityLabel={`Editing ${props.label}`}
      testID="day-picker"
    >
      {props.onRename ? (
        <View style={{ gap: space.xs }}>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setNameError(null);
            }}
            onSubmitEditing={done}
            {...inputColors}
            style={styles.input}
            maxLength={HABIT_MAX_LENGTH}
            returnKeyType="done"
            submitBehavior="submit"
            accessibilityLabel="Habit name"
            testID="habit-rename"
          />
          {nameError ? <Text style={styles.error}>{nameError}</Text> : null}
        </View>
      ) : null}
      <View style={styles.pills}>
        {DAY_NAMES.map((name, d) => {
          const selected = on.includes(d);
          const last = selected && on.length === 1;
          return (
            <Pressable
              key={d}
              onPress={() => toggle(d)}
              disabled={last}
              hitSlop={4}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: last }}
              accessibilityLabel={name}
              style={({ pressed }) => [styles.pill, selected && styles.pillOn, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextOn]}>{name.charAt(0)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.actions}>
        <IconButton
          icon={ArrowUp}
          size={16}
          label={`Move ${props.label} up`}
          onPress={() => props.onUp?.()}
          disabled={!props.onUp}
          filled
        />
        <IconButton
          icon={ArrowDown}
          size={16}
          label={`Move ${props.label} down`}
          onPress={() => props.onDown?.()}
          disabled={!props.onDown}
          filled
        />
        {props.skip ? (
          <Pressable
            onPress={props.skip.onToggle}
            accessibilityRole="button"
            accessibilityLabel={
              props.skip.skipped ? `Don’t skip ${props.label}` : `Skip ${props.label} ${props.skip.dayWord}`
            }
            accessibilityHint={props.skip.skipped ? undefined : 'It won’t count, and its streak carries on'}
            style={({ pressed }) => [
              styles.skipButton,
              props.skip!.skipped && styles.skipOn,
              pressed && { opacity: 0.7 },
            ]}
            testID="habit-skip"
          >
            <SkipForward size={14} color={props.skip.skipped ? colors.text : colors.textSecondary} strokeWidth={2.5} />
            <Text style={[styles.skipText, props.skip.skipped && { color: colors.text }]}>
              {props.skip.skipped ? 'Don’t skip' : `Skip ${props.skip.dayWord}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.pickerFoot}>
        <Text style={styles.schedule}>{props.days ? weekdaysLabel(props.days) : 'Every day'}</Text>
        <Pressable onPress={done} accessibilityRole="button" accessibilityLabel="Done editing habit" hitSlop={8}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Shown from two days in a row: one day is not yet a streak. */
function StreakChip({ days, cap }: { days: number; cap: number }) {
  if (days < 2) return null;
  return (
    <View style={styles.streak} accessible accessibilityLabel={`${days}-day streak`}>
      <Flame size={13} color={colors.energy} strokeWidth={2.5} />
      <Text style={styles.streakText}>{days >= cap ? `${cap}+` : days}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  count: { ...type.label, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center' },
  toggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: HIT,
    paddingVertical: space.xs,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.habits, borderColor: colors.habits },
  boxSkipped: { borderStyle: 'dashed' },
  labelCol: { flex: 1, gap: 1 },
  label: { ...type.body, color: colors.text },
  schedule: { ...type.caption, color: colors.textSecondary },
  restHeader: {
    ...type.label,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  resting: { opacity: 0.6 },
  picker: { gap: space.sm, paddingLeft: 36, paddingBottom: space.sm },
  pills: { flexDirection: 'row', gap: 6 },
  pill: {
    flex: 1,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillOn: { backgroundColor: tint(colors.habits, 0.18), borderColor: colors.habits },
  pillText: { ...type.label, color: colors.textSecondary },
  pillTextOn: { color: colors.text, fontWeight: '700' },
  pickerFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: HIT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: 'transparent',
    marginLeft: 'auto',
  },
  skipOn: { borderColor: colors.textMuted },
  skipText: { ...type.label, color: colors.textSecondary },
  done: { ...type.label, color: colors.habits, fontWeight: '700' },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.cardRaised,
  },
  streakText: { ...type.caption, color: colors.textSecondary, fontWeight: '700', fontVariant: ['tabular-nums'] },
  labelDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  composer: { gap: space.xs },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  error: { ...type.caption, color: colors.danger },
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
